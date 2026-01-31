import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { metricsRoutes } from './api/routes/metrics';
import { chainlinkRoutes } from './api/routes/chainlink';
import { healthRoutes } from './api/routes/health';
import { logger } from './utils/logger';

const app = Fastify({
  logger: logger,
});

// Register plugins
await app.register(cors, {
  origin: true,
});

await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindow,
});

// Register routes
await app.register(healthRoutes, { prefix: '/api/v1' });
await app.register(metricsRoutes, { prefix: '/api/v1' });
await app.register(chainlinkRoutes, { prefix: '/api/v1' });

// Start server
const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`🚀 TrendZap Oracle running on port ${config.port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();

export { app };
