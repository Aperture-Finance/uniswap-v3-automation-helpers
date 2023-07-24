import { ApertureSupportedChainId } from '@aperture_finance/uniswap-v3-automation-sdk';
import { Token } from '@uniswap/sdk-core';
import axios from 'axios';
import { writeFileSync } from 'fs';

import { getChainInfo } from '../chain';
import { getTokenPriceListFromCoingecko } from '../price';

async function generateWhitelistOfSpecificPools(
  chainId: number,
  poolsToFetch: string[],
) {
  const response = await axios.post(
    getChainInfo(chainId).uniswap_subgraph_url!,
    {
      operationName: 'fetchSpecificPools',
      query: `
        query SpecificPools {
            pools(where: {id_in: ["${poolsToFetch.join('", "')}"]}) {
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
  const pools = response.data.data.pools;
  const USDCe = '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8';
  // Create a set of unique token ids
  const tokens: Set<string> = new Set();
  for (const pool of pools) {
    if (pool.token0.id.toLowerCase() == USDCe) {
      pool.token0.symbol = 'USDC.e';
      pool.token0.name = 'Bridged USDC (USDC.e)';
    } else if (pool.token1.id.toLowerCase() == USDCe) {
      pool.token1.symbol = 'USDC.e';
      pool.token1.name = 'Bridged USDC (USDC.e)';
    }
    tokens.add(pool.token0.id);
    tokens.add(pool.token1.id);
  }

  writeFileSync(
    `data/whitelistedSpecificPools-${chainId}.json`,
    JSON.stringify(pools, null, 2),
    'utf-8',
  );

  // Convert the Set to an Array of Token objects, then pass to the function
  const tokenArray = Array.from(tokens).map(
    (addr) => new Token(chainId, addr, 18),
  );

  // call coingecko API for all tokens at once
  const priceList = await getTokenPriceListFromCoingecko(tokenArray);

  // loop over priceList and print information
  for (const token in priceList) {
    if (priceList[token]) {
      console.log(`Token ${token}'s price is ${priceList[token]}.`);
    } else {
      console.log(`Token ${token} doesn't have Coingecko price support.`);
    }
  }
  console.log(
    `Generated ${pools.length} whitelisted pools for chain id ${chainId}, involving ${tokens.size} tokens.`,
  );
}

generateWhitelistOfSpecificPools(
  ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID,
  [
    '0x6f38e884725a116c9c7fbf208e79fe8828a2595f', // WETH-USDC 0.01%
    '0xc473e2aee3441bf9240be85eb122abb059a3b57c', // WETH-USDC 0.3%
    '0x42fc852a750ba93d5bf772ecdc857e87a86403a9', // WETH-USDC 1%
    '0xfeaa137f43f88b7f767f5a67978fff8ec11cc6ef', // WETH-FXS (Frax Share) 1%
    '0x2fe69fc0383ca71f5d76c4c858540cb2be2e10be', // WETH-STG (Stargate) 0.3%
    '0x04a8cddbb62e3499c8e84ccf77192ed6292bf29d', // gOHM-USDC.e 0.3%
    '0x25ab7dc4ddcacb6fe75694904db27602175245f1', // LDO-WETH 1%
    '0x446bf9748b4ea044dd759d9b9311c70491df8f29', // RDNT-WETH 0.3%
    '0x90d2fb08af9e9323d7cbd364181bda1e7d3c2c2f', // LDO-USDC 1%
    '0xc94560e81ce1a78b2a5f686a9a913e8560c00234', // SPA-WETH 1%
  ],
);
generateWhitelistOfSpecificPools(
  ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
  [
    '0x78235d08b2ae7a3e00184329212a4d7acd2f9985', // LDO-USDC 1%
    '0x08f68110f1e0ca67c80a24b4bd206675610f445d', // gOHM-USDC 0.3%
    '0x893f503fac2ee1e5b78665db23f9c94017aae97d', // OHM-USDC 0.3%
  ],
);
