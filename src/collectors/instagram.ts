import { config } from '../config';
import { logger } from '../utils/logger';
import type { RawMetrics } from './index';

/**
 * Instagram metrics collector.
 *
 * Strategy (in priority order):
 * 1. Instagram Graph API (requires access_token) — official, gives full metrics
 * 2. Instagram oEmbed API (requires app_id) — public, limited metadata
 * 3. Web scrape fallback — no auth, unreliable but works for MVP
 */
export class InstagramCollector {
  async collect(url: string, metric: string): Promise<RawMetrics> {
    const postId = this.extractPostId(url);

    if (!postId) {
      throw new Error('Invalid Instagram URL');
    }

    logger.info({ postId, metric }, 'Fetching Instagram metrics');

    // Try Graph API first if access token is configured
    if (config.instagram.accessToken) {
      try {
        return await this.collectViaGraphApi(postId, metric);
      } catch (err) {
        logger.warn({ err }, 'Graph API failed, falling back to oEmbed');
      }
    }

    // Fallback: oEmbed API (requires app_id but no user token)
    if (config.instagram.appId) {
      try {
        return await this.collectViaOEmbed(url, postId, metric);
      } catch (err) {
        logger.warn({ err }, 'oEmbed failed, falling back to web scrape');
      }
    }

    // Last resort: web scrape
    return await this.collectViaWebScrape(url, postId, metric);
  }

  /**
   * Instagram Graph API — requires a valid long-lived access token
   * with instagram_basic permission.
   * Docs: https://developers.facebook.com/docs/instagram-api/reference/ig-media
   */
  private async collectViaGraphApi(
    postId: string,
    metric: string
  ): Promise<RawMetrics> {
    // First, we need to find the media ID from the shortcode.
    // The Graph API uses numeric media IDs, not shortcodes.
    // We search for it via the user's media endpoint or use the oEmbed to get the media ID.
    const mediaId = await this.resolveMediaId(postId);

    const fields = 'id,like_count,comments_count,media_type,timestamp,caption';
    const response = await fetch(
      `https://graph.instagram.com/v21.0/${mediaId}?fields=${fields}&access_token=${config.instagram.accessToken}`
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Instagram Graph API error ${response.status}: ${text}`);
    }

    const data = await response.json();

    const metricMap: Record<string, string> = {
      likes: 'like_count',
      comments: 'comments_count',
    };

    const metricKey = metricMap[metric];
    if (!metricKey) {
      throw new Error(`Unsupported metric for Instagram: ${metric}`);
    }

    const value = data[metricKey] ?? 0;

    return {
      postId,
      platform: 'instagram',
      metric,
      value,
      rawData: {
        media: data,
        source: 'graph_api',
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Resolve a shortcode to a numeric Instagram media ID via oEmbed.
   */
  private async resolveMediaId(shortcode: string): Promise<string> {
    const url = `https://www.instagram.com/p/${shortcode}/`;
    const oembedUrl = `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${config.instagram.appId}|${config.instagram.appSecret}`;

    const response = await fetch(oembedUrl);
    if (!response.ok) {
      throw new Error(`Failed to resolve media ID: ${response.status}`);
    }

    const data = await response.json();
    // The oEmbed response includes media_id for Graph API lookups
    if (data.media_id) {
      return data.media_id;
    }

    // Fallback: use the shortcode as-is (works for some API versions)
    return shortcode;
  }

  /**
   * Instagram oEmbed API — returns basic embed metadata.
   * Requires Facebook App ID but no user access token.
   */
  private async collectViaOEmbed(
    url: string,
    postId: string,
    metric: string
  ): Promise<RawMetrics> {
    const oembedUrl = `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${config.instagram.appId}|${config.instagram.appSecret}`;

    const response = await fetch(oembedUrl);

    if (!response.ok) {
      throw new Error(`Instagram oEmbed error: ${response.status}`);
    }

    const data = await response.json();

    // oEmbed doesn't return like/comment counts directly.
    // We can only get author_name, title, thumbnail_url, etc.
    // For actual metrics, we need Graph API or scraping.
    throw new Error(
      `Instagram oEmbed does not provide ${metric} counts. Configure Graph API access token.`
    );
  }

  /**
   * Web scrape fallback — fetch the Instagram post page and parse
   * structured data (JSON-LD or meta tags) for engagement metrics.
   */
  private async collectViaWebScrape(
    url: string,
    postId: string,
    metric: string
  ): Promise<RawMetrics> {
    // Instagram embeds some data in meta tags and __additionalDataLoaded
    const postUrl = url.includes('instagram.com')
      ? url
      : `https://www.instagram.com/p/${postId}/`;

    const response = await fetch(postUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Instagram web scrape error: ${response.status}`);
    }

    const html = await response.text();

    // Try to extract metrics from meta tags
    const interactionCount = html.match(
      /"interactionCount"\s*:\s*"?(\d+)"?/
    );
    const userInteractionCount = html.match(
      /"userInteractionCount"\s*:\s*"?(\d+)"?/
    );

    // Try to extract from the shared data JSON
    const sharedDataMatch = html.match(
      /window\._sharedData\s*=\s*({.+?});<\/script>/
    );

    let value = 0;

    if (sharedDataMatch) {
      try {
        const sharedData = JSON.parse(sharedDataMatch[1]);
        const media =
          sharedData?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;

        if (media) {
          const metricMap: Record<string, number> = {
            likes: media.edge_media_preview_like?.count ?? 0,
            comments: media.edge_media_to_parent_comment?.count ?? 0,
            views: media.video_view_count ?? 0,
          };

          if (!(metric in metricMap)) {
            throw new Error(`Unsupported metric for Instagram: ${metric}`);
          }

          value = metricMap[metric];
        }
      } catch (parseErr) {
        logger.warn({ parseErr }, 'Failed to parse shared data');
      }
    }

    // Fallback to interaction count meta
    if (value === 0 && interactionCount) {
      value = parseInt(interactionCount[1], 10);
    }
    if (value === 0 && userInteractionCount) {
      value = parseInt(userInteractionCount[1], 10);
    }

    if (value === 0) {
      throw new Error(
        'Could not extract Instagram metrics. Configure Graph API access token for reliable data.'
      );
    }

    return {
      postId,
      platform: 'instagram',
      metric,
      value,
      rawData: {
        source: 'web_scrape',
        fetchedAt: new Date().toISOString(),
      },
    };
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
