import { config } from '../config';
import { logger } from '../utils/logger';
import type { RawMetrics } from './index';

/**
 * TikTok metrics collector.
 *
 * Strategy (in priority order):
 * 1. TikTok Research API (requires client_key + client_secret) — gives full metrics
 * 2. TikTok oEmbed API (no auth required) — gives basic view/like/share counts
 *
 * The oEmbed endpoint is publicly accessible and returns the embed HTML which
 * includes engagement counts in the response metadata.
 */
export class TikTokCollector {
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  async collect(url: string, metric: string): Promise<RawMetrics> {
    const videoId = this.extractVideoId(url);

    if (!videoId) {
      throw new Error('Invalid TikTok URL');
    }

    logger.info({ videoId, metric }, 'Fetching TikTok metrics');

    // Try Research API first if credentials are configured
    if (config.tiktok.clientKey && config.tiktok.clientSecret) {
      try {
        return await this.collectViaResearchApi(url, videoId, metric);
      } catch (err) {
        logger.warn({ err }, 'Research API failed, falling back to oEmbed');
      }
    }

    // Fallback: oEmbed API (no auth required)
    return await this.collectViaOEmbed(url, videoId, metric);
  }

  /**
   * TikTok Research API — requires approved developer access.
   * Docs: https://developers.tiktok.com/doc/research-api-specs-query-videos
   */
  private async collectViaResearchApi(
    url: string,
    videoId: string,
    metric: string
  ): Promise<RawMetrics> {
    const token = await this.getAccessToken();

    const response = await fetch(
      'https://open.tiktokapis.com/v2/research/video/query/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filters: {
            video_ids: [videoId],
          },
          fields: [
            'id',
            'like_count',
            'comment_count',
            'share_count',
            'view_count',
            'create_time',
          ],
          max_count: 1,
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TikTok Research API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      data?: { videos?: Array<Record<string, unknown>> };
    };
    const video = data?.data?.videos?.[0];

    if (!video) {
      throw new Error('Video not found via Research API');
    }

    const metricMap: Record<string, string> = {
      likes: 'like_count',
      views: 'view_count',
      comments: 'comment_count',
      shares: 'share_count',
    };

    const metricKey = metricMap[metric];
    if (!metricKey) {
      throw new Error(`Unsupported metric for TikTok: ${metric}`);
    }

    const value = Number(video[metricKey] ?? 0);
    if (!Number.isFinite(value)) {
      throw new Error(`TikTok returned a non-numeric ${metric} value`);
    }

    return {
      postId: videoId,
      platform: 'tiktok',
      metric,
      value,
      rawData: {
        video,
        source: 'research_api',
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * TikTok oEmbed API — publicly accessible, no auth required.
   * Returns basic metadata including author and title.
   * For metrics, we scrape the embed page statistics.
   */
  private async collectViaOEmbed(
    url: string,
    videoId: string,
    metric: string
  ): Promise<RawMetrics> {
    // oEmbed endpoint returns metadata about the video
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;

    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'TrendZap-Oracle/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`TikTok oEmbed error: ${response.status}`);
    }

    const data = await response.json();

    // oEmbed doesn't return detailed metrics directly, but we can get
    // basic counts from the TikTok web page or use the video info API
    // For MVP, try the unofficial web API as a fallback
    let value = 0;

    try {
      value = await this.scrapeVideoMetrics(videoId, metric);
    } catch {
      logger.warn(
        { videoId },
        'Could not scrape metrics, returning oEmbed data only'
      );
      // oEmbed doesn't give us counts, so we can't resolve — throw
      throw new Error(
        `TikTok oEmbed does not provide ${metric} counts. Configure Research API credentials.`
      );
    }

    return {
      postId: videoId,
      platform: 'tiktok',
      metric,
      value,
      rawData: {
        oembed: data,
        source: 'oembed',
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Scrape video metrics from TikTok's unofficial web API.
   * This endpoint returns JSON for a single video's statistics.
   */
  private async scrapeVideoMetrics(
    videoId: string,
    metric: string
  ): Promise<number> {
    const response = await fetch(
      `https://www.tiktok.com/api/item/detail/?itemId=${videoId}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`TikTok web API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      itemInfo?: { itemStruct?: { stats?: Record<string, number> } };
    };
    const stats = data?.itemInfo?.itemStruct?.stats;

    if (!stats) {
      throw new Error('Could not extract video stats from TikTok web API');
    }

    const metricMap: Record<string, string> = {
      likes: 'diggCount',
      views: 'playCount',
      comments: 'commentCount',
      shares: 'shareCount',
    };

    const key = metricMap[metric];
    if (!key) {
      throw new Error(`Unsupported metric for TikTok: ${metric}`);
    }

    return stats[key] ?? 0;
  }

  /**
   * Get an OAuth2 access token for the TikTok Research API.
   */
  private async getAccessToken(): Promise<string> {
    // Reuse cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: config.tiktok.clientKey,
          client_secret: config.tiktok.clientSecret,
          grant_type: 'client_credentials',
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`TikTok OAuth error: ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    // Expire 5 minutes early to avoid edge cases
    this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

    return this.accessToken!;
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
