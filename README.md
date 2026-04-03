# TrendZap Oracle

> Social media data oracle service for TrendZap - fetching and verifying engagement metrics from X/Twitter, TikTok, Instagram, and YouTube.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)

---

## Overview

The TrendZap Oracle is a critical infrastructure component that bridges off-chain social media metrics with on-chain prediction markets. It fetches, validates, and delivers engagement data (likes, retweets, views, etc.) to the TrendZap smart contracts via Chainlink.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TrendZap Oracle Service                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  Collector  │    │  Validator  │    │    Cache    │    │  Chainlink  │  │
│  │   Layer     │───▶│    Layer    │───▶│    Layer    │───▶│   Adapter   │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│         │                  │                  │                  │          │
│         ▼                  ▼                  ▼                  ▼          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Twitter   │    │  Cross-ref  │    │    Redis    │    │  Smart      │  │
│  │   TikTok    │    │  Bot Check  │    │    Store    │    │  Contract   │  │
│  │   IG/YT     │    │  Anomaly    │    │             │    │             │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

### Data Collection
- **X/Twitter API v2** - Official API for tweets, likes, retweets, views
- **TikTok API** - Video views, likes, shares, comments
- **Instagram Graph API** - Post engagement metrics
- **YouTube Data API** - Video views, likes, comments

### Data Validation
- **Cross-reference verification** - Compare metrics from multiple sources
- **Anomaly detection** - Flag suspicious metric spikes
- **Bot traffic filtering** - Detect and filter artificial engagement
- **Historical trend analysis** - Validate against expected patterns

### Chainlink Integration
- **External Adapter** - Standard Chainlink EA implementation
- **Job specifications** - Pre-configured Chainlink jobs
- **Multi-node support** - Redundant oracle responses

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.0
- **Framework**: Fastify
- **Cache**: Redis
- **Queue**: BullMQ
- **Validation**: Zod
- **Testing**: Vitest

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- Redis 7+
- API keys for social platforms

### Installation

```bash
# Clone the repository
git clone https://github.com/trendzaphq/trendzap-oracle.git
cd trendzap-oracle

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Start Redis (if not running)
docker run -d -p 6379:6379 redis:7-alpine

# Run in development
pnpm dev
```

### Configuration

```env
# Server
PORT=3001
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379

# Twitter/X API
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_BEARER_TOKEN=your_bearer_token

# TikTok API
TIKTOK_CLIENT_KEY=your_client_key
TIKTOK_CLIENT_SECRET=your_client_secret

# Instagram/Facebook API
INSTAGRAM_ACCESS_TOKEN=your_access_token

# YouTube API
YOUTUBE_API_KEY=your_api_key

# Chainlink
CHAINLINK_NODE_URL=http://localhost:6688
CHAINLINK_JOB_ID=your_job_id
```

## API Endpoints

### Get Metrics

```http
GET /api/v1/metrics?url={post_url}&platform={platform}&metric={metric_type}
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Social media post URL |
| `platform` | string | `twitter`, `tiktok`, `instagram`, `youtube` |
| `metric` | string | `likes`, `retweets`, `views`, `comments` |

**Response:**
```json
{
  "success": true,
  "data": {
    "postId": "1234567890",
    "platform": "twitter",
    "metric": "likes",
    "value": 150000,
    "timestamp": "2026-01-31T12:00:00Z",
    "confidence": 0.98,
    "sources": ["twitter_api", "social_blade"]
  }
}
```

### Chainlink External Adapter

```http
POST /api/v1/chainlink
```

**Request:**
```json
{
  "id": "1",
  "data": {
    "url": "https://twitter.com/elonmusk/status/123456",
    "platform": "twitter",
    "metric": "likes"
  }
}
```

**Response:**
```json
{
  "jobRunID": "1",
  "data": {
    "result": 150000
  },
  "statusCode": 200
}
```

## Project Structure

```
trendzap-oracle/
├── src/
│   ├── api/
│   │   ├── routes/
│   │   │   ├── metrics.ts
│   │   │   ├── chainlink.ts
│   │   │   └── health.ts
│   │   └── server.ts
│   ├── collectors/
│   │   ├── twitter.ts
│   │   ├── tiktok.ts
│   │   ├── instagram.ts
│   │   ├── youtube.ts
│   │   └── index.ts
│   ├── validators/
│   │   ├── post-validator.ts
│   │   ├── engagement-validator.ts
│   │   ├── bot-detector.ts
│   │   └── anomaly-detector.ts
│   ├── chainlink/
│   │   ├── adapter.ts
│   │   └── job-specs/
│   │       └── twitter-metrics.toml
│   ├── cache/
│   │   └── redis.ts
│   ├── queue/
│   │   └── metrics-queue.ts
│   ├── types/
│   │   └── index.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   └── rate-limiter.ts
│   └── index.ts
├── test/
│   ├── collectors/
│   ├── validators/
│   └── api/
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── chainlink-jobs/
│   └── twitter-metrics.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Run Tests

```bash
# Unit tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

### Linting

```bash
# Lint
pnpm lint

# Fix lint issues
pnpm lint:fix
```

### Build

```bash
# Build for production
pnpm build

# Start production server
pnpm start
```

## Deployment

### Docker

```bash
# Build image
docker build -t trendzap-oracle .

# Run container
docker run -d \
  -p 3001:3001 \
  -e REDIS_URL=redis://redis:6379 \
  -e TWITTER_BEARER_TOKEN=xxx \
  trendzap-oracle
```

### Docker Compose

```bash
docker-compose up -d
```

## Chainlink Node Setup

1. Deploy Chainlink node on Avalanche
2. Add external adapter bridge pointing to this service
3. Create job spec using the templates in `chainlink-jobs/`
4. Configure the `SocialOracle` contract with job ID

## Rate Limiting

| Platform | Requests/15min | Strategy |
|----------|----------------|----------|
| Twitter | 450 | Token bucket with backoff |
| TikTok | 1000 | Fixed window |
| Instagram | 200 | Sliding window |
| YouTube | 10,000 units | Quota management |

## Security

- API keys stored in environment variables
- Request signing for Chainlink callbacks
- Rate limiting per client
- Input validation with Zod
- CORS configuration

## Related Repositories

| Repository | Description |
|------------|-------------|
| [trendzap-contracts](https://github.com/trendzaphq/trendzap-contracts) | Smart contracts that consume oracle data |
| [trendzap-app](https://github.com/trendzaphq/trendzap-app) | Frontend that displays oracle data |
| [trendzap-risk](https://github.com/trendzaphq/trendzap-risk) | Risk engine that validates oracle outputs |

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Powering TrendZap's on-chain social metrics 📊</strong>
</p>
