import { logger } from '../utils/logger';
import type { RawMetrics } from './index';

export class TikTokCollector {
  async collect(url: string, metric: string): Promise<RawMetrics> {
    const videoId = this.extractVideoId(url);

    if (!videoId) {
      throw new Error('Invalid TikTok URL');
    }

    logger.info({ videoId, metric }, 'Fetching TikTok metrics');

    // TODO: Implement TikTok API integration
    // TikTok requires OAuth and business API access
    
    throw new Error('TikTok integration not yet implemented');
  }

  private extractVideoId(url: string): string | null {
    const patterns = [
      /tiktok\.com\/@[\w.]+\/video\/(\d+)/,
      /vm\.tiktok\.com\/(\w+)/,
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
