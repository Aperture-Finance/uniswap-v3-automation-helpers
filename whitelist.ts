import { Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import { getAddress } from 'ethers/lib/utils';
import { ApertureSupportedChainId } from './chain';

export interface WhitelistedPool {
  token0: Token;
  token1: Token;
  feeTier: FeeAmount;
}

/**
 * Returns a map of whitelisted pools for the specified chain.
 * @param chainId Chain id.
 * @returns A map of whitelisted pools keyed by pool addresses.
 */
export function getWhitelistedPools(
  chainId: ApertureSupportedChainId,
  whitelistedPoolsJson: {
    id: string;
    feeTier: string;
    token0: {
      id: string;
      decimals: string;
      symbol: string;
      name: string;
    };
    token1: {
      id: string;
      decimals: string;
      symbol: string;
      name: string;
    };
  }[],
): Map<string, WhitelistedPool> {
  const whitelistedPoolsMap = new Map();
  for (const pool of whitelistedPoolsJson) {
    whitelistedPoolsMap.set(getAddress(pool.id), {
      feeTier: Number(pool.feeTier),
      token0: new Token(
        chainId,
        getAddress(pool.token0.id),
        Number(pool.token0.decimals),
        pool.token0.symbol,
        pool.token0.name,
      ),
      token1: new Token(
        chainId,
        getAddress(pool.token1.id),
        Number(pool.token1.decimals),
        pool.token1.symbol,
        pool.token1.name,
      ),
    });
  }
  return whitelistedPoolsMap;
}
