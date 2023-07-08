import { ApertureSupportedChainId } from '@aperture_finance/uniswap-v3-automation-sdk';
import { getAddress } from 'ethers/lib/utils';

import whitelistedPoolsEthereum from './data/whitelistedPools-1.json';
import whitelistedPoolsGoerli from './data/whitelistedPools-5.json';
import whitelistedPoolsArbitrum from './data/whitelistedPools-42161.json';
import {
  WhitelistedPool,
  getWhitelistedPools,
  getWhitelistedTokens,
} from './whitelist';

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
  whitelistedTokens?: Map<string, string>;
  maxGasCeiling: number;
}

export const CHAIN_ID_TO_INFO: {
  [key in ApertureSupportedChainId]: ChainInfo;
} = {
  [ApertureSupportedChainId.GOERLI_TESTNET_CHAIN_ID]: {
    uniswap_v3_factory: getAddress(
      '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    ),
    uniswap_v3_nonfungible_position_manager: getAddress(
      '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    ),
    aperture_uniswap_v3_automan: getAddress(
      '0xdB1fE098232A00A8B81dd6c2A911f2486cb374EE',
    ),
    infura_network_id: 'goerli',
    whitelistedPools: getWhitelistedPools(
      ApertureSupportedChainId.GOERLI_TESTNET_CHAIN_ID,
      whitelistedPoolsGoerli,
    ),
    whitelistedTokens: getWhitelistedTokens(
      ApertureSupportedChainId.GOERLI_TESTNET_CHAIN_ID,
      whitelistedPoolsGoerli,
    ),
    maxGasCeiling: 0.05,
  },
  [ApertureSupportedChainId.ARBITRUM_GOERLI_TESTNET_CHAIN_ID]: {
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
    maxGasCeiling: 0.05,
  },

  [ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID]: {
    uniswap_v3_factory: getAddress(
      '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    ),
    uniswap_v3_nonfungible_position_manager: getAddress(
      '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    ),
    aperture_uniswap_v3_automan: getAddress(
      '0x00000000F43c5264bA236DD7a49224F1241858e4',
    ),
    coingecko_asset_platform_id: 'ethereum',
    infura_network_id: 'mainnet',
    uniswap_subgraph_url:
      'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3',
    whitelistedPools: getWhitelistedPools(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      whitelistedPoolsEthereum,
    ),
    whitelistedTokens: getWhitelistedTokens(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      whitelistedPoolsEthereum,
    ),
    maxGasCeiling: 0.5,
  },
  [ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID]: {
    uniswap_v3_factory: getAddress(
      '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    ),
    uniswap_v3_nonfungible_position_manager: getAddress(
      '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    ),
    aperture_uniswap_v3_automan: getAddress(
      '0x00000000F43c5264bA236DD7a49224F1241858e4',
    ),
    coingecko_asset_platform_id: 'arbitrum-one',
    infura_network_id: 'arbitrum',
    uniswap_subgraph_url:
      'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-arbitrum-one',
    whitelistedPools: getWhitelistedPools(
      ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID,
      whitelistedPoolsArbitrum,
    ),
    whitelistedTokens: getWhitelistedTokens(
      ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID,
      whitelistedPoolsArbitrum,
    ),
    maxGasCeiling: 0.2,
  },
};

export function getChainInfo(chainId: ApertureSupportedChainId) {
  return CHAIN_ID_TO_INFO[chainId];
}
