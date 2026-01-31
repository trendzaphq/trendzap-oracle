import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getMetrics } from '../../collectors';
import { validateMetrics } from '../../validators';
import { logger } from '../../utils/logger';

const chainlinkRequestSchema = z.object({
  id: z.string(),
  data: z.object({
    url: z.string().url(),
    platform: z.enum(['twitter', 'tiktok', 'instagram', 'youtube']),
    metric: z.enum(['likes', 'retweets', 'views', 'comments', 'shares', 'followers']),
  }),
});

export async function chainlinkRoutes(fastify: FastifyInstance) {
  /**
   * Chainlink External Adapter endpoint
   * Follows the Chainlink EA specification
   */
  fastify.post('/chainlink', async (request, reply) => {
    const startTime = Date.now();

    try {
      const { id, data } = chainlinkRequestSchema.parse(request.body);

      logger.info({ jobRunId: id, data }, 'Chainlink request received');

      // Fetch metrics from collector
      const rawMetrics = await getMetrics(data.url, data.platform, data.metric);

      // Validate metrics
      const validatedMetrics = await validateMetrics(rawMetrics);

      const response = {
        jobRunID: id,
        data: {
          result: validatedMetrics.value,
          postId: rawMetrics.postId,
          platform: data.platform,
          metric: data.metric,
          confidence: validatedMetrics.confidence,
          timestamp: new Date().toISOString(),
        },
        statusCode: 200,
      };

      logger.info(
        { 
          jobRunId: id, 
          result: validatedMetrics.value,
          duration: Date.now() - startTime 
        }, 
        'Chainlink request fulfilled'
      );

      return response;
    } catch (error) {
      logger.error({ error }, 'Chainlink request failed');

      const jobRunId = (request.body as any)?.id || '0';

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          jobRunID: jobRunId,
          status: 'errored',
          error: {
            name: 'ValidationError',
            message: 'Invalid request parameters',
          },
          statusCode: 400,
        });
      }

      return reply.status(500).send({
        jobRunID: jobRunId,
        status: 'errored',
        error: {
          name: 'InternalError',
          message: 'Failed to fetch metrics',
        },
        statusCode: 500,
      });
    }
  });
}
