import type { RawMetrics } from '../collectors';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface ValidatedMetrics {
  value: number;
  confidence: number;
  sources: string[];
  isValid: boolean;
  warnings: string[];
}

/**
 * Score a collected metric for trustworthiness.
 *
 * The penalties are scaled to the detector scores rather than applied as flat
 * constants. Previously a bot signal cost a flat 0.20 and an anomaly signal 0.15
 * against a 0.8 threshold, which meant `1.0 - 0.20 = 0.80 >= 0.80` still passed:
 * no single check could ever fail a resolution, and the anomaly detector could not
 * fail one even in principle. A strongly-flagged metric now falls below the
 * threshold on its own.
 */
export async function validateMetrics(raw: RawMetrics): Promise<ValidatedMetrics> {
  const warnings: string[] = [];
  let confidence = 1.0;

  const botScore = await checkForBotActivity(raw);
  if (botScore > 0.5) {
    // 0.5 → -0.20, 1.0 → -0.50
    confidence -= 0.2 + (botScore - 0.5) * 0.6;
    warnings.push(`Potential bot activity detected (score ${botScore.toFixed(2)})`);
  }

  const anomalyScore = await checkForAnomalies(raw);
  if (anomalyScore > 0.5) {
    // 0.5 → -0.20, 1.0 → -0.50
    confidence -= 0.2 + (anomalyScore - 0.5) * 0.6;
    warnings.push(`Unusual metric pattern detected (score ${anomalyScore.toFixed(2)})`);
  }

  // Metrics older than maxMetricAge are not trusted for resolution. This bound was
  // configured (MAX_METRIC_AGE_SECONDS) but never enforced.
  const fetchedAt = raw.rawData?.fetchedAt;
  if (typeof fetchedAt === 'string') {
    const ageSeconds = (Date.now() - new Date(fetchedAt).getTime()) / 1000;
    if (Number.isFinite(ageSeconds) && ageSeconds > config.maxMetricAge) {
      confidence -= 0.3;
      warnings.push(`Metric is stale (${Math.round(ageSeconds)}s > ${config.maxMetricAge}s)`);
    }
  }

  confidence = Math.max(0, confidence);

  if (confidence < config.minConfidenceScore) {
    logger.warn({ raw, confidence, warnings }, 'Metrics below confidence threshold');
  }

  return {
    value: raw.value,
    confidence,
    // Single-source: the collectors query one platform API per market. The service
    // header used to claim ≥2-source aggregation with a 5% agreement margin; no such
    // aggregation exists, so this reports what is actually true.
    sources: [`${raw.platform}_api`],
    isValid: confidence >= config.minConfidenceScore,
    warnings,
  };
}

/**
 * Bot activity heuristics — returns 0.0 (clean) to 1.0 (likely bot).
 *
 * Signals:
 * - Engagement rate vs follower count anomalies (>30% ER is suspicious for large accounts)
 * - Like/view ratio outside expected band (0.2%–15%)
 * - Comment/like ratio extremes (<0.01 or >1.0)
 * - Retweet/like ratio extremes
 */
async function checkForBotActivity(raw: RawMetrics): Promise<number> {
  const d = raw.rawData;
  let score = 0;
  const signals: string[] = [];

  // Flatten nested rawData structures from different collectors:
  // Twitter: rawData.metrics.{ like_count, impression_count, retweet_count, reply_count }
  // YouTube: rawData.statistics.{ likeCount, viewCount, commentCount }
  // TikTok/Instagram: flat rawData fields
  const m = (d.metrics ?? d.statistics ?? d) as Record<string, unknown>;

  const likes = Number(m.like_count ?? m.likeCount ?? 0);
  const views = Number(m.impression_count ?? m.viewCount ?? m.view_count ?? 0);
  const comments = Number(m.reply_count ?? m.commentCount ?? m.comment_count ?? 0);
  const shares = Number(m.retweet_count ?? m.shareCount ?? m.share_count ?? 0);
  // author followers may be on tweet.author_public_metrics or flat
  const tweetAuthor = (d.tweet as Record<string, unknown> | undefined);
  const authorMetrics = tweetAuthor?.author_public_metrics as Record<string, unknown> | undefined;
  const followers = Number(authorMetrics?.followers_count ?? d.author_followers ?? d.followerCount ?? 0);

  // Like-to-view ratio check (organic: 0.2%–15%)
  if (views > 1000 && likes > 0) {
    const lvRatio = likes / views;
    if (lvRatio > 0.2) {
      score += 0.35;
      signals.push(`suspicious like/view ratio: ${(lvRatio * 100).toFixed(1)}%`);
    }
  }

  // Engagement rate check (organic max: ~10–15% for micro, <3% for mega)
  if (followers > 10_000 && likes > 0) {
    const engRate = (likes + comments + shares) / followers;
    if (engRate > 0.3) {
      score += 0.3;
      signals.push(`unusually high engagement rate: ${(engRate * 100).toFixed(1)}%`);
    }
  }

  // Comment-to-like ratio — bot farms rarely comment
  if (likes > 500 && comments < likes * 0.001) {
    score += 0.15;
    signals.push('abnormally low comment/like ratio (potential like farming)');
  }

  // Share-to-like ratio anomaly (coordinated resharing)
  if (likes > 100 && shares > likes * 3) {
    score += 0.2;
    signals.push('share count greatly exceeds likes (coordinated spreading)');
  }

  if (signals.length > 0) {
    logger.debug({ postId: raw.postId, platform: raw.platform, signals }, 'Bot activity signals found');
  }

  return Math.min(score, 1.0);
}

/**
 * Anomaly scoring — returns 0.0 (normal) to 1.0 (anomalous).
 *
 * Signals:
 * - Metric value = 0 on a closed market
 * - Implausibly large value (>100M for most metrics)
 * - Value is negative (data corruption)
 * - Round-number gaming (e.g., exactly 1,000,000 likes)
 */
async function checkForAnomalies(raw: RawMetrics): Promise<number> {
  let score = 0;
  const value = raw.value;

  // Negative or zero — almost certainly a collection error
  if (value < 0) return 1.0;
  if (value === 0) {
    score += 0.4;
  }

  // Implausibly massive value (>500M views/likes in a single collection)
  if (value > 500_000_000) {
    score += 0.5;
  }

  // Exactly round number at suspicious magnitudes (gaming)
  const roundMillions = [1_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000];
  if (roundMillions.includes(value)) {
    score += 0.25;
  }

  // NaN / Infinity guard
  if (!Number.isFinite(value)) return 1.0;

  return Math.min(score, 1.0);
}

export { validateMetrics as default };
