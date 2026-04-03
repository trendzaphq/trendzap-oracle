import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { config } from '../../config';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      service: 'trendzap-oracle',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  fastify.get('/ready', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'error'> = {
      redis: 'error',
      oracle_key: 'error',
      contract: 'error',
    };

    // Check Redis connection
    try {
      const redis = new Redis(config.redisUrl, { lazyConnect: true, connectTimeout: 3000 });
      await redis.connect();
      await redis.ping();
      checks.redis = 'ok';
      await redis.quit();
    } catch {
      checks.redis = 'error';
    }

    // Check oracle private key is configured
    if (config.oracle?.privateKey && config.oracle.privateKey !== '0x') {
      checks.oracle_key = 'ok';
    }

    // Check contract address is configured
    if (config.oracle?.marketContractAddress) {
      checks.contract = 'ok';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');

    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'ready' : 'degraded',
      checks,
    });
  });
}
