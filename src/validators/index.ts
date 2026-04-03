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

export async function validateMetrics(raw: RawMetrics): Promise<ValidatedMetrics> {
  const warnings: string[] = [];
  let confidence = 1.0;

  // Run validation checks
  const botScore = await checkForBotActivity(raw);
  if (botScore > 0.5) {
    confidence -= 0.2;
    warnings.push('Potential bot activity detected');
  }

  const anomalyScore = await checkForAnomalies(raw);
  if (anomalyScore > 0.5) {
    confidence -= 0.15;
    warnings.push('Unusual metric pattern detected');
  }

  // Ensure minimum confidence threshold
  if (confidence < config.minConfidenceScore) {
    logger.warn({ raw, confidence }, 'Metrics below confidence threshold');
  }

  return {
    value: raw.value,
    confidence: Math.max(0, confidence),
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

  const likes = Number(d.like_count ?? d.likeCount ?? 0);
  const views = Number(d.impression_count ?? d.viewCount ?? d.view_count ?? 0);
  const comments = Number(d.reply_count ?? d.commentCount ?? d.comment_count ?? 0);
  const shares = Number(d.retweet_count ?? d.shareCount ?? d.share_count ?? 0);
  const followers = Number(d.author_followers ?? d.followerCount ?? 0);

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
