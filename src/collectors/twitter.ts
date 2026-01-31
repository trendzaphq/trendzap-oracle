import { TwitterApi } from 'twitter-api-v2';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { RawMetrics } from './index';

export class TwitterCollector {
  private client: TwitterApi;

  constructor() {
    this.client = new TwitterApi(config.twitter.bearerToken);
  }

  async collect(url: string, metric: string): Promise<RawMetrics> {
    // Extract tweet ID from URL
    const tweetId = this.extractTweetId(url);

    if (!tweetId) {
      throw new Error('Invalid Twitter URL');
    }

    logger.info({ tweetId, metric }, 'Fetching Twitter metrics');

    // Fetch tweet data
    const tweet = await this.client.v2.singleTweet(tweetId, {
      'tweet.fields': ['public_metrics', 'created_at', 'author_id'],
    });

    if (!tweet.data) {
      throw new Error('Tweet not found');
    }

    const metrics = tweet.data.public_metrics;

    if (!metrics) {
      throw new Error('Metrics not available');
    }

    // Map metric type to Twitter metric field
    const metricMap: Record<string, keyof typeof metrics> = {
      likes: 'like_count',
      retweets: 'retweet_count',
      replies: 'reply_count',
      views: 'impression_count',
      quotes: 'quote_count',
    };

    const metricKey = metricMap[metric];

    if (!metricKey) {
      throw new Error(`Unsupported metric: ${metric}`);
    }

    const value = metrics[metricKey] || 0;

    return {
      postId: tweetId,
      platform: 'twitter',
      metric,
      value,
      rawData: {
        tweet: tweet.data,
        metrics,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  private extractTweetId(url: string): string | null {
    // Match various Twitter URL formats
    const patterns = [
      /twitter\.com\/\w+\/status\/(\d+)/,
      /x\.com\/\w+\/status\/(\d+)/,
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
