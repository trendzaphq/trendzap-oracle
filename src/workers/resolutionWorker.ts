/**
 * TrendZap Oracle — BullMQ Market Resolution Worker
 *
 * How this works:
 * 1. When a market is created on-chain, the factory API posts a job to the
 *    "market-resolution" queue with a `delay` equal to (resolutionTime - now).
 * 2. This worker fires when the delay expires.
 * 3. It fetches final metrics from the social API, validates them, and calls
 *    resolveMarketOnChain() to submit the resolution transaction.
 * 4. On failure it retries with exponential backoff (max 5 attempts).
 */

import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { getMetrics } from '../collectors';
import { validateMetrics } from '../validators';
import { resolveMarketOnChain, isMarketResolvable } from '../chain/resolver';
import { logger } from '../utils/logger';

export interface ResolutionJobData {
  marketId: number;
  postUrl: string;
  platform: 'twitter' | 'tiktok' | 'instagram' | 'youtube';
  metricType: string;
  threshold: string; // stored as string to avoid BigInt serialization issues
  resolutionTime: number; // unix seconds
}

// Shared Redis connection for BullMQ
const redisConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 500, 10_000); // cap at 10s
    logger.warn({ times, delayMs: delay }, 'Redis reconnecting');
    return delay;
  },
  reconnectOnError: () => true, // always attempt reconnect on stream errors
});

redisConnection.on('error', (err) => {
  logger.error({ err: err.message }, 'Redis connection error — will retry');
});
redisConnection.on('reconnecting', () => {
  logger.warn('Redis reconnecting...');
});

// Queue — producers add jobs here (e.g. the metrics API route when a new market
// is indexed from on-chain events)
export const resolutionQueue = new Queue<ResolutionJobData>('market-resolution', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 15_000, // 15s base, then 30s, 60s, 120s, 240s
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

/**
 * Schedule a market for resolution.
 * Called when a MarketCreated event is detected by the subgraph watcher.
 */
export async function scheduleResolution(data: ResolutionJobData): Promise<void> {
  const delayMs = Math.max(0, (data.resolutionTime - Math.floor(Date.now() / 1000)) * 1000);

  await resolutionQueue.add(`resolve-market-${data.marketId}`, data, {
    delay: delayMs,
    jobId: `market-resolve-${data.marketId}`, // idempotent — no duplicates
  });

  logger.info({
    marketId: data.marketId,
    resolvesInSeconds: Math.round(delayMs / 1000),
    resolutionTime: new Date(data.resolutionTime * 1000).toISOString(),
  }, 'Market resolution scheduled');
}

/**
 * Resolution worker — processes one market at a time.
 */
export function createResolutionWorker(): Worker<ResolutionJobData> {
  const worker = new Worker<ResolutionJobData>(
    'market-resolution',
    async (job: Job<ResolutionJobData>) => {
      const { marketId, postUrl, platform, metricType, threshold } = job.data;

      logger.info({ marketId, attempt: job.attemptsMade + 1 }, 'Processing market resolution job');

      // 1. Check if market is still resolvable on-chain
      const resolvable = await isMarketResolvable(marketId);
      if (!resolvable.resolvable) {
        // If already resolved or cancelled — complete silently (not a failure)
        if (resolvable.reason?.includes('Already resolved') || resolvable.reason?.includes('cancelled')) {
          logger.info({ marketId, reason: resolvable.reason }, 'Market already settled — skipping');
          return;
        }
        // Not at end time yet — reschedule 30s from now
        if (resolvable.reason?.includes('End time not reached')) {
          logger.warn({ marketId, reason: resolvable.reason }, 'End time not reached yet — rescheduling');
          await scheduleResolution({ ...job.data, resolutionTime: job.data.resolutionTime + 30 });
          return;
        }
        throw new Error(`Market not resolvable: ${resolvable.reason}`);
      }

      // 2. Collect metrics from the social platform
      const rawMetrics = await getMetrics(postUrl, platform, metricType);

      // 3. Validate — check for bots & anomalies
      const validated = await validateMetrics(rawMetrics);
      if (!validated.isValid) {
        logger.error({
          marketId,
          confidence: validated.confidence,
          warnings: validated.warnings,
        }, 'Metrics failed validation — aborting resolution');
        throw new Error(`Metrics invalid (confidence ${validated.confidence.toFixed(2)}): ${validated.warnings.join(', ')}`);
      }

      // 4. Resolve on-chain
      const finalValue = BigInt(Math.round(validated.value));
      const thresholdBig = BigInt(threshold);

      const result = await resolveMarketOnChain(marketId, finalValue, thresholdBig);

      logger.info({
        marketId,
        outcome: result.outcome,
        finalValue: finalValue.toString(),
        threshold,
        txHash: result.txHash,
      }, 'Market resolved successfully ✓');

      // Publish to Redis pub/sub for real-time frontend updates
      await redisConnection.publish(
        'market:resolved',
        JSON.stringify({
          marketId,
          outcome: result.outcome,
          finalValue: finalValue.toString(),
          txHash: result.txHash,
          resolvedAt: Date.now(),
        }),
      );
    },
    {
      connection: redisConnection,
      concurrency: 3, // resolve max 3 markets in parallel
      limiter: {
        max: 10,
        duration: 60_000, // max 10 resolutions per minute (rate limiting)
      },
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, marketId: job.data.marketId }, 'Resolution job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({
      jobId: job?.id,
      marketId: job?.data.marketId,
      attempt: job?.attemptsMade,
      error: err.message,
    }, 'Resolution job failed');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Resolution job stalled — will be retried');
  });

  return worker;
}

export { redisConnection };
