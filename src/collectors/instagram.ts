import { logger } from '../utils/logger';
import type { RawMetrics } from './index';

export class InstagramCollector {
  async collect(url: string, metric: string): Promise<RawMetrics> {
    const postId = this.extractPostId(url);

    if (!postId) {
      throw new Error('Invalid Instagram URL');
    }

    logger.info({ postId, metric }, 'Fetching Instagram metrics');

    // TODO: Implement Instagram Graph API integration
    // Requires Facebook Business account and API access
    
    throw new Error('Instagram integration not yet implemented');
  }

  private extractPostId(url: string): string | null {
    const patterns = [
      /instagram\.com\/p\/([\w-]+)/,
      /instagram\.com\/reel\/([\w-]+)/,
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
