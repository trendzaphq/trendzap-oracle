import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { metricsRoutes } from './api/routes/metrics';
import { chainlinkRoutes } from './api/routes/chainlink';
import { healthRoutes } from './api/routes/health';
import { logger } from './utils/logger';
import { createResolutionWorker } from './workers/resolutionWorker';
import { scheduleRoutes } from './api/routes/schedule';

const app = Fastify({
  logger: logger as any,
});

// Register plugins.
//
// `origin: true` reflected whatever Origin was sent, which is effectively open.
// Restrict to the configured app origins instead.
await app.register(cors, {
  origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false,
});

await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow,
});

// Register routes
await app.register(healthRoutes, { prefix: '/api/v1' });
await app.register(metricsRoutes, { prefix: '/api/v1' });
await app.register(chainlinkRoutes, { prefix: '/api/v1' });
await app.register(scheduleRoutes, { prefix: '/api/v1' });

// Start the BullMQ resolution worker
const worker = createResolutionWorker();
logger.info('Resolution worker started');

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down oracle service');
  await worker.close();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'Uncaught exception');
  shutdown('uncaughtException').catch(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error({ reason: msg }, 'Unhandled promise rejection');
  shutdown('unhandledRejection').catch(() => process.exit(1));
});

// Start server
const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`TrendZap Oracle running on port ${config.port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();

export { app };
