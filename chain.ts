import { getAddress } from 'ethers/lib/utils';
import whitelistedPoolsEthereum from './data/whitelistedPools-1.json';
import whitelistedPoolsArbitrum from './data/whitelistedPools-42161.json';
import { WhitelistedPool, getWhitelistedPools } from './whitelist';

export type ChainId = number;
export const ETHEREUM_MAINNET_CHAIN_ID: ChainId = 1;
export const ARBITRUM_MAINNET_CHAIN_ID: ChainId = 42161;
export const GOERLI_TESTNET_CHAIN_ID: ChainId = 5;
export const ARBITRUM_GOERLI_TESTNET_CHAIN_ID: ChainId = 421613;

export interface ChainInfo {
  uniswap_v3_factory: string;
  uniswap_v3_nonfungible_position_manager: string;
  aperture_uniswap_v3_automan: string;
  infura_network_id: string;
  // Only populated for mainnets. See https://api.coingecko.com/api/v3/asset_platforms.
  coingecko_asset_platform_id?: string;
  // Only populated for mainnets.
  uniswap_subgraph_url?: string;
  // Only populated for mainnets. Map from pool addresses to `WhitelistedPool` with information about the two tokens and pool fee tier.
  whitelistedPools?: Map<string, WhitelistedPool>;
}

export const CHAIN_ID_TO_INFO: Map<ChainId, ChainInfo> = new Map([
  [
    GOERLI_TESTNET_CHAIN_ID,
    {
      uniswap_v3_factory: getAddress(
        '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      ),
      uniswap_v3_nonfungible_position_manager: getAddress(
        '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      ),
      aperture_uniswap_v3_automan: getAddress(
        '0x7cE50ece5c924c1b8b10275F0cC546Db6EB5915a',
      ),
      infura_network_id: 'goerli',
    },
  ],
  [
    ARBITRUM_GOERLI_TESTNET_CHAIN_ID,
    {
      uniswap_v3_factory: getAddress(
        '0x4893376342d5D7b3e31d4184c08b265e5aB2A3f6',
      ),
      uniswap_v3_nonfungible_position_manager: getAddress(
        '0x622e4726a167799826d1E1D150b076A7725f5D81',
      ),
      aperture_uniswap_v3_automan: getAddress(
        '0xcd9002c47348c54B1C044e30E449CdAe44124139',
      ),
      infura_network_id: 'arbitrum-goerli',
    },
  ],
  [
    ETHEREUM_MAINNET_CHAIN_ID,
    {
      uniswap_v3_factory: getAddress(
        '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      ),
      uniswap_v3_nonfungible_position_manager: getAddress(
        '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      ),
      // WARNING: This is a placeholder. Automan has not been deployed on the mainnet.
      aperture_uniswap_v3_automan: getAddress(
        '0xE81df2Fc4f54D96e5f209e2D135f34E75725f34f',
      ),
      coingecko_asset_platform_id: 'ethereum',
      infura_network_id: 'mainnet',
      uniswap_subgraph_url:
        'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
      whitelistedPools: getWhitelistedPools(
        ETHEREUM_MAINNET_CHAIN_ID,
        whitelistedPoolsEthereum,
      ),
    },
  ],
  [
    ARBITRUM_MAINNET_CHAIN_ID,
    {
      uniswap_v3_factory: getAddress(
        '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      ),
      uniswap_v3_nonfungible_position_manager: getAddress(
        '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      ),
      // WARNING: This is a placeholder. Automan has not been deployed on Arbitrum mainnet.
      aperture_uniswap_v3_automan: getAddress(
        '0xE81df2Fc4f54D96e5f209e2D135f34E75725f34f',
      ),
      coingecko_asset_platform_id: 'arbitrum-one',
      infura_network_id: 'arbitrum',
      uniswap_subgraph_url:
        'https://api.thegraph.com/subgraphs/name/ianlapham/arbitrum-minimal',
      whitelistedPools: getWhitelistedPools(
        ARBITRUM_MAINNET_CHAIN_ID,
        whitelistedPoolsArbitrum,
      ),
    },
  ],
]);

export function getChainInfo(chainId: number) {
  const chainInfo = CHAIN_ID_TO_INFO.get(chainId);
  if (chainInfo === undefined) {
    throw 'Unsupported chain id';
  }
  return chainInfo;
}
