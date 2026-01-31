import type { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      service: 'trendzap-oracle',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  fastify.get('/ready', async () => {
    // TODO: Check Redis connection, API credentials, etc.
    return {
      status: 'ready',
      checks: {
        redis: 'ok',
        twitter: 'ok',
        chainlink: 'ok',
      },
    };
  });
}
