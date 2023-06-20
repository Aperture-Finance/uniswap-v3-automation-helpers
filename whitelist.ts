import { ApertureSupportedChainId } from '@aperture_finance/uniswap-v3-automation-sdk';
import { Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import axios from 'axios';
import { getAddress } from 'ethers/lib/utils';
import { getChainInfo } from './chain';

export interface WhitelistedPool {
  token0: Token;
  token1: Token;
  feeTier: FeeAmount;
}

/**
 * Returns a map of whitelisted pools for the specified chain.
 * @param chainId Chain id.
 * @param whitelistedPoolsJson Whitelisted pools JSON.
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

/**
 * Returns a map of whitelisted tokens for the specified chain.
 * @param chainId Chain id.
 * @param whitelistedPoolsJson Whitelisted pools JSON.
 * @returns A map of whitelisted tokens keyed by token symbols.
 */
export function getWhitelistedTokens(
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
): Map<
  string,
  {
    [chainId: number]: string;
  }
> {
  const whitelistedTokens = new Map();
  for (const pool of whitelistedPoolsJson) {
    if (!whitelistedTokens.has(pool.token0.symbol)) {
      whitelistedTokens.set(pool.token0.symbol, {
        [chainId]: getAddress(pool.token0.id),
      });
    }
    if (!whitelistedTokens.has(pool.token1.symbol)) {
      whitelistedTokens.set(pool.token1.symbol, {
        [chainId]: getAddress(pool.token1.id),
      });
    }
  }
  return whitelistedTokens;
}

/**
 * Returns a map of whitelisted tokens for the specified chain.
 * @param chainId Chain id.
 * @returns A map of whitelisted tokens keyed by token symbols / tickers.
 */
export async function getAllWhitelistedTokens(chainId: number) {
  const response = await axios.post(
    getChainInfo(chainId).uniswap_subgraph_url!,
    {
      operationName: 'topPools',
      query: `
        query topPools {
          pools(
            first: 50
            orderBy: totalValueLockedUSD
            orderDirection: desc
            subgraphError: allow
          ) {
            id
            totalValueLockedUSD
            feeTier
            volumeUSD
            token0 {
              id
              symbol
              decimals
              name
            }
            token1 {
              id
              symbol
              decimals
              name
            }
          }
        }`,
      variables: {},
    },
  );
  const pools = response.data.data.pools.filter(
    (pool: { volumeUSD: string }) => pool.volumeUSD != '0',
  );
  const filteredPools =
    chainId === ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID
      ? pools.filter(
          (pool: { id: string }) =>
            // ETH-ETHM pool with 5000 ETH and ETHM; no trades at all during the 120-day period before May 9, 2023.
            pool.id != '0x40e629a26d96baa6d81fae5f97205c2ab2c1ff29' &&
            // ETH-BTT pool with nearly 0 ETH and 27.59 trillion BTT tokens.
            pool.id != '0x64a078926ad9f9e88016c199017aea196e3899e1' &&
            // Pool involves ZVT (Zombie Virus Token) which isn't on Coingecko.
            pool.id != '0x58fcd403610e772d68726b55183eb958a7581731' &&
            // Pool involves SpongeBob token which isn't on Coingecko.
            pool.id != '0xf935f557e06a7d040dea4691f90c9a755301818b',
        )
      : pools.filter(
          (pool: { id: string }) =>
            // ETH-G with no trade at all during the 41-day period before May 9, 2023.
            pool.id != '0x98c1c8530de9d59f3977dc230bec73fef0011aff' &&
            // PSI-ETH with no trades at all during the 90-day period before May 9, 2023.
            pool.id != '0x50c7390dfdd3756139e6efb5a461c2eb7331ceb4' &&
            // Pool involves CRYPTO (New Crypto Space) which isn't on Coingecko.
            pool.id != '0x14af1804dbbf7d621ecc2901eef292a24a0260ea' &&
            // Pool involves Taikula token which isn't on Coingecko.
            pool.id != '0x83b43b0652cced8de54c4f941c97ecbb07fbfa01' &&
            // Pool involves RNDT (Radiant) token which isn't on Coingecko.
            pool.id != '0x2334d412da299a21486b663d12c392185b313aaa',
        );
  const tokens: {
    [ticker: string]: {
      name: string;
      ticker: string;
      decimals: number;
      address: string;
    };
  } = {};
  filteredPools.forEach((pool: any) => {
    const ticker0 = pool.token0.symbol.toLowerCase();
    const ticker1 = pool.token1.symbol.toLowerCase();
    if (!tokens[ticker0]) {
      tokens[ticker0] = {
        name: pool.token0.name,
        ticker: ticker0,
        decimals: pool.token0.decimals,
        address: pool.token0.id,
      };
    }
    if (!tokens[ticker1]) {
      tokens[ticker1] = {
        name: pool.token1.name,
        ticker: ticker1,
        decimals: pool.token1.decimals,
        address: pool.token1.id,
      };
    }
  });
  return tokens;
}
