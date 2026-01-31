import { logger } from '../utils/logger';
import type { RawMetrics } from './index';
import { config } from '../config';

export class YouTubeCollector {
  private apiKey: string;

  constructor() {
    this.apiKey = config.youtube.apiKey;
  }

  async collect(url: string, metric: string): Promise<RawMetrics> {
    const videoId = this.extractVideoId(url);

    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    logger.info({ videoId, metric }, 'Fetching YouTube metrics');

    // Fetch video statistics from YouTube Data API
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      throw new Error('Video not found');
    }

    const statistics = data.items[0].statistics;

    // Map metric type to YouTube statistics field
    const metricMap: Record<string, string> = {
      views: 'viewCount',
      likes: 'likeCount',
      comments: 'commentCount',
    };

    const metricKey = metricMap[metric];

    if (!metricKey) {
      throw new Error(`Unsupported metric: ${metric}`);
    }

    const value = parseInt(statistics[metricKey] || '0', 10);

    return {
      postId: videoId,
      platform: 'youtube',
      metric,
      value,
      rawData: {
        statistics,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  private extractVideoId(url: string): string | null {
    const patterns = [
      /youtube\.com\/watch\?v=([\w-]+)/,
      /youtu\.be\/([\w-]+)/,
      /youtube\.com\/shorts\/([\w-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }
}
