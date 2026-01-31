import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getMetrics } from '../../collectors';
import { validateMetrics } from '../../validators';
import { logger } from '../../utils/logger';

const metricsQuerySchema = z.object({
  url: z.string().url(),
  platform: z.enum(['twitter', 'tiktok', 'instagram', 'youtube']),
  metric: z.enum(['likes', 'retweets', 'views', 'comments', 'shares', 'followers']),
});

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (request, reply) => {
    try {
      const query = metricsQuerySchema.parse(request.query);

      logger.info({ query }, 'Fetching metrics');

      // Fetch metrics from collector
      const rawMetrics = await getMetrics(query.url, query.platform, query.metric);

      // Validate metrics
      const validatedMetrics = await validateMetrics(rawMetrics);

      return {
        success: true,
        data: {
          postId: rawMetrics.postId,
          platform: query.platform,
          metric: query.metric,
          value: validatedMetrics.value,
          timestamp: new Date().toISOString(),
          confidence: validatedMetrics.confidence,
          sources: validatedMetrics.sources,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Error fetching metrics');

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request parameters',
          details: error.errors,
        });
      }

      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch metrics',
      });
    }
  });
}
