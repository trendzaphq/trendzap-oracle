/**
 * TrendZap Oracle — On-Chain Resolution Trigger
 * 
 * This module is responsible for fetching final metric values and
 * calling ViralityMarket.resolveMarket() on Avalanche.
 * 
 * Flow:
 * 1. BullMQ job fires when market.resolutionTime is reached
 * 2. Aggregate metrics from ≥2 sources, validate within 5% margin
 * 3. Sign and submit resolution transaction on-chain
 * 4. Emit RESOLVED event to Redis pub/sub for frontend fanout
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche, avalancheFuji } from 'viem/chains';
import { logger } from '../utils/logger';
import { config } from '../config';

// JSON ABI — abitype human-readable parser does not support named tuple members
const MARKET_ABI = [
  {
    type: 'function',
    name: 'resolveMarket',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'metricValue', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getMarket',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          {
            name: 'params',
            type: 'tuple',
            components: [
              { name: 'postUrl', type: 'string' },
              { name: 'platform', type: 'uint8' },
              { name: 'metricType', type: 'uint8' },
              { name: 'threshold', type: 'uint256' },
              { name: 'startTime', type: 'uint256' },
              { name: 'endTime', type: 'uint256' },
              { name: 'resolutionTime', type: 'uint256' },
            ],
          },
          {
            name: 'state',
            type: 'tuple',
            components: [
              { name: 'qOver', type: 'uint256' },
              { name: 'qUnder', type: 'uint256' },
              { name: 'b', type: 'uint256' },
              { name: 'totalVolume', type: 'uint256' },
              { name: 'feesCollected', type: 'uint256' },
              { name: 'poolBalance', type: 'uint256' },
            ],
          },
          { name: 'status', type: 'uint8' },
          { name: 'outcome', type: 'uint8' },
          { name: 'resolvedValue', type: 'uint256' },
          { name: 'creator', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'resolvedAt', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextMarketId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

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
  const chain = config.oracle?.chainId === 43114 ? avalanche : avalancheFuji;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.oracle?.rpcUrl || 'https://api.avax.network/ext/bc/C/rpc'),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.oracle?.rpcUrl || 'https://api.avax.network/ext/bc/C/rpc'),
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

  const chain = config.oracle?.chainId === 43114 ? avalanche : avalancheFuji;
  const publicClient = createPublicClient({
    chain,
    transport: http(config.oracle?.rpcUrl || 'https://api.avax.network/ext/bc/C/rpc'),
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
