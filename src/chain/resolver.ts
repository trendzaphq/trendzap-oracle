/**
 * TrendZap Oracle — On-Chain Resolution Trigger
 * 
 * This module is responsible for fetching final metric values and
 * calling ViralityMarketV2.resolveMarket() on Avalanche.
 * 
 * Flow:
 * 1. BullMQ job fires when market.resolutionTime is reached
 * 2. Aggregate metrics from ≥2 sources, validate within 5% margin
 * 3. Sign and submit resolution transaction on-chain
 * 4. Emit RESOLVED event to Redis pub/sub for frontend fanout
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { logger } from '../utils/logger';
import { config } from '../config';

// ABI for the resolution function only (minimal for security)
const MARKET_ABI = parseAbi([
  'function resolveMarket(uint256 marketId, uint256 metricValue) external',
  'function getMarket(uint256 marketId) external view returns ((tuple(string postUrl, uint8 platform, uint8 metricType, uint256 threshold, uint256 startTime, uint256 endTime, uint256 resolutionTime) params, tuple(uint256 qOver, uint256 qUnder, uint256 b, uint256 totalVolume, uint256 feesCollected, uint256 poolBalance) state, uint8 status, uint8 outcome, uint256 resolvedValue, address creator, uint256 createdAt, uint256 resolvedAt))',
  'function nextMarketId() external view returns (uint256)',
]);

export interface ResolutionResult {
  marketId: number;
  metricValue: bigint;
  outcome: 'OVER' | 'UNDER';
  txHash: string;
  gasUsed: bigint;
}

export interface ResolutionError {
  marketId: number;
  error: string;
  retryable: boolean;
}

/**
 * Resolves a market on-chain by calling ViralityMarketV2.resolveMarket()
 */
export async function resolveMarketOnChain(
  marketId: number,
  finalMetricValue: bigint,
  threshold: bigint,
): Promise<ResolutionResult> {
  const privateKey = config.oracle?.privateKey as `0x${string}`;
  const contractAddress = config.oracle?.marketContractAddress as `0x${string}`;

  if (!privateKey || privateKey === '0x') {
    throw new Error('ORACLE_PRIVATE_KEY not configured');
  }
  if (!contractAddress) {
    throw new Error('MARKET_CONTRACT_ADDRESS not configured');
  }

  const account = privateKeyToAccount(privateKey);
  const chain = config.oracle?.chainId === 43114 ? avalancheFuji : avalancheFuji; // swap to mainnet when ready

  const publicClient = createPublicClient({
    chain,
    transport: http(config.oracle?.rpcUrl || 'https://api.avax-test.network/ext/bc/C/rpc'),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.oracle?.rpcUrl || 'https://api.avax-test.network/ext/bc/C/rpc'),
  });

  logger.info({
    marketId,
    finalMetricValue: finalMetricValue.toString(),
    threshold: threshold.toString(),
    resolver: account.address,
    contract: contractAddress,
  }, 'Submitting on-chain resolution');

  // Check oracle wallet balance — alert if low
  const balance = await publicClient.getBalance({ address: account.address });
  const LOW_BALANCE_THRESHOLD = BigInt('100000000000000000'); // 0.1 AVAX
  if (balance < LOW_BALANCE_THRESHOLD) {
    logger.warn(
      { balance: balance.toString(), address: account.address },
      'Oracle wallet balance low — please fund',
    );
  }

  // Estimate gas first
  const gasEstimate = await publicClient.estimateContractGas({
    address: contractAddress,
    abi: MARKET_ABI,
    functionName: 'resolveMarket',
    args: [BigInt(marketId), finalMetricValue],
    account: account.address,
  });

  // Submit resolution
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: MARKET_ABI,
    functionName: 'resolveMarket',
    args: [BigInt(marketId), finalMetricValue],
    gas: (gasEstimate * 120n) / 100n, // 20% buffer
  });

  logger.info({ marketId, txHash }, 'Resolution transaction submitted');

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 2,
    timeout: 120_000,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Resolution tx reverted: ${txHash}`);
  }

  const outcome = finalMetricValue >= threshold ? 'OVER' : 'UNDER';

  logger.info({
    marketId,
    txHash,
    outcome,
    gasUsed: receipt.gasUsed.toString(),
  }, 'Market resolved on-chain ✓');

  return {
    marketId,
    metricValue: finalMetricValue,
    outcome,
    txHash,
    gasUsed: receipt.gasUsed,
  };
}

/**
 * Validate that a market is ready to be resolved
 * Returns false if market was already resolved or not yet at end time
 */
export async function isMarketResolvable(marketId: number): Promise<{
  resolvable: boolean;
  reason?: string;
  threshold?: bigint;
}> {
  const contractAddress = config.oracle?.marketContractAddress as `0x${string}`;
  if (!contractAddress) {
    return { resolvable: false, reason: 'Contract address not configured' };
  }

  const chain = avalancheFuji;
  const publicClient = createPublicClient({
    chain,
    transport: http(config.oracle?.rpcUrl || 'https://api.avax-test.network/ext/bc/C/rpc'),
  });

  try {
    const market = await publicClient.readContract({
      address: contractAddress,
      abi: MARKET_ABI,
      functionName: 'getMarket',
      args: [BigInt(marketId)],
    }) as any;

    const now = BigInt(Math.floor(Date.now() / 1000));
    const status = market.status as number;
    const endTime = market.params.endTime as bigint;
    const threshold = market.params.threshold as bigint;

    // Status enum: 0=PENDING, 1=ACTIVE, 2=CLOSED, 3=RESOLVED, 4=CANCELLED, 5=DISPUTED
    if (status === 3) return { resolvable: false, reason: 'Already resolved' };
    if (status === 4) return { resolvable: false, reason: 'Market cancelled' };
    if (status !== 1 && status !== 2) {
      return { resolvable: false, reason: `Invalid status: ${status}` };
    }
    if (now < endTime) {
      return { resolvable: false, reason: `End time not reached (${Number(endTime - now)}s remaining)` };
    }

    return { resolvable: true, threshold };
  } catch (err) {
    return {
      resolvable: false,
      reason: `Failed to read market: ${(err as Error).message}`,
    };
  }
}
