import { TwitterCollector } from './twitter';
import { TikTokCollector } from './tiktok';
import { InstagramCollector } from './instagram';
import { YouTubeCollector } from './youtube';
import { logger } from '../utils/logger';

export interface RawMetrics {
  postId: string;
  platform: string;
  metric: string;
  value: number;
  rawData: Record<string, unknown>;
}

const collectors = {
  twitter: new TwitterCollector(),
  tiktok: new TikTokCollector(),
  instagram: new InstagramCollector(),
  youtube: new YouTubeCollector(),
};

export async function getMetrics(
  url: string,
  platform: 'twitter' | 'tiktok' | 'instagram' | 'youtube',
  metric: string
): Promise<RawMetrics> {
  const collector = collectors[platform];

  if (!collector) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  logger.info({ url, platform, metric }, 'Collecting metrics');

  return collector.collect(url, metric);
}

export { TwitterCollector, TikTokCollector, InstagramCollector, YouTubeCollector };
