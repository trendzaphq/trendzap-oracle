import 'dotenv/config';

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Twitter/X
  twitter: {
    apiKey: process.env.TWITTER_API_KEY || '',
    apiSecret: process.env.TWITTER_API_SECRET || '',
    bearerToken: process.env.TWITTER_BEARER_TOKEN || '',
    accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
    accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
  },

  // TikTok
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
  },

  // Instagram
  instagram: {
    appId: process.env.INSTAGRAM_APP_ID || '',
    appSecret: process.env.INSTAGRAM_APP_SECRET || '',
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
  },

  // YouTube
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
  },

  // Chainlink
  chainlink: {
    nodeUrl: process.env.CHAINLINK_NODE_URL || '',
    jobId: process.env.CHAINLINK_JOB_ID || '',
    externalInitiatorName: process.env.CHAINLINK_EXTERNAL_INITIATOR_NAME || '',
    externalInitiatorSecret: process.env.CHAINLINK_EXTERNAL_INITIATOR_SECRET || '',
  },

  // Rate Limiting
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),

  // Blockchain / On-chain resolution
  oracle: {
    privateKey: process.env.ORACLE_PRIVATE_KEY || '0x',
    marketContractAddress: process.env.MARKET_CONTRACT_ADDRESS || '',
    rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
    chainId: parseInt(process.env.CHAIN_ID || '43113', 10),
  },

  // Validation
  minConfidenceScore: parseFloat(process.env.MIN_CONFIDENCE_SCORE || '0.8'),
  maxMetricAge: parseInt(process.env.MAX_METRIC_AGE_SECONDS || '300', 10),
};
