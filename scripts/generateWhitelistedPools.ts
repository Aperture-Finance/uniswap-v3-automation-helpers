import axios from 'axios';
import { writeFileSync } from 'fs';
import { getChainInfo } from '../chain';
import { config as dotenvConfig } from 'dotenv';
import { ApertureSupportedChainId } from '@aperture_finance/uniswap-v3-automation-sdk';

dotenvConfig();

async function generateWhitelistedPools(chainId: number) {
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
  writeFileSync(
    `data/whitelistedPools-${chainId}.json`,
    JSON.stringify(filteredPools),
  );
  const tokens: Set<string> = new Set();
  for (const pool of filteredPools) {
    tokens.add(pool.token0.id);
    tokens.add(pool.token1.id);
  }
  for (const token of tokens) {
    const priceResponse = await axios.get(
      `https://pro-api.coingecko.com/api/v3/simple/token_price/${getChainInfo(
        chainId,
      )
        .coingecko_asset_platform_id!}?contract_addresses=${token}&vs_currencies=usd&x_cg_pro_api_key=${
        process.env.COINGECKO_API_KEY
      }`,
    );
    if (token in priceResponse.data) {
      console.log(
        `Token ${token}'s price is ${priceResponse.data[token]['usd']}.`,
      );
    } else {
      console.log(`Token ${token} doesn't have Coingecko price support.`);
    }
  }
  console.log(
    `Generated ${filteredPools.length} whitelisted pools for chain id ${chainId}, involving ${tokens.size} tokens.`,
  );
}

generateWhitelistedPools(ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID);
generateWhitelistedPools(ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID);
// There are 42 whitelisted pools involving 26 tokens on Ethereum mainnet.
// There are 23 whitelisted pools involving 17 tokens on Arbitrum.
