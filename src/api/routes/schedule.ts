/**
 * POST /api/v1/schedule
 * Called by the app (or an admin) when a new market is created.
 * Enqueues a BullMQ resolution job for when the market ends.
 *
 * Requires ORACLE_API_KEY. This endpoint was previously unauthenticated, and the
 * worker resolved against the postUrl supplied here — so anyone able to reach the
 * service could make a market settle on a post they controlled. The worker now reads
 * the URL from the contract (see workers/resolutionWorker.ts), and this endpoint is
 * authenticated as well.
 *
 * `postUrl` is retained only for logging and mismatch detection; it is not used to
 * decide what a market resolves against.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { scheduleResolution } from '../../workers/resolutionWorker';
import { logger } from '../../utils/logger';
import { requireApiKey } from '../auth';

const ScheduleBody = z.object({
  marketId: z.number().int().nonnegative(),
  postUrl: z.string().url(),
  platform: z.enum(['twitter', 'tiktok', 'instagram', 'youtube']),
  metricType: z.string().min(1),
  threshold: z.string().regex(/^\d+$/, 'Must be a numeric string'),
  resolutionTime: z.number().int().positive(),
});

export async function scheduleRoutes(app: FastifyInstance) {
  app.post('/schedule', {
    preHandler: requireApiKey,
    schema: {
      body: {
        type: 'object',
        required: ['marketId', 'postUrl', 'platform', 'metricType', 'threshold', 'resolutionTime'],
        properties: {
          marketId: { type: 'number' },
          postUrl: { type: 'string' },
          platform: { type: 'string', enum: ['twitter', 'tiktok', 'instagram', 'youtube'] },
          metricType: { type: 'string' },
          threshold: { type: 'string' },
          resolutionTime: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const parsed = ScheduleBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }

    const data = parsed.data;
    const now = Math.floor(Date.now() / 1000);

    if (data.resolutionTime <= now) {
      return reply.code(400).send({ error: 'resolutionTime must be in the future' });
    }

    await scheduleResolution(data);

    logger.info({ marketId: data.marketId }, 'Market resolution scheduled via API');
    return reply.code(202).send({
      success: true,
      marketId: data.marketId,
      scheduledFor: new Date(data.resolutionTime * 1000).toISOString(),
      delaySeconds: data.resolutionTime - now,
    });
  });
}
