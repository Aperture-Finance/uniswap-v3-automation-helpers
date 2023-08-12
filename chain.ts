import { ApertureSupportedChainId } from '@aperture_finance/uniswap-v3-automation-sdk';
import { Token } from '@uniswap/sdk-core';
import { getAddress } from 'ethers/lib/utils';

import whitelistedPoolsEthereum from './data/whitelistedPools-1.json';
import whitelistedPoolsGoerli from './data/whitelistedPools-5.json';
import whitelistedPoolsArbitrum from './data/whitelistedPools-42161.json';
import {
  WhitelistedPool,
  getWhitelistedPools,
  getWhitelistedTokens,
} from './whitelist';

export interface ChainSpecificRoutingAPIInfo {
  url: string;
  // Routing API: https://github.com/Uniswap/routing-api/
  // Unified Routing API: https://github.com/Uniswap/unified-routing-api
  // Uniswap maintains an official unified routing API at https://api.uniswap.org/v2/quote.
  // The unified routing API handler internally queries the routing API but we don't know the address of the latter.
  // For the Manta UniV3 fork we only support the routing API and it doesn't make sense to deploy the unified routing API for Manta.
  // Therefore, we need to support querying both routing API (for Manta) and unified routing API (for UniV3 official chains).
  type: 'ROUTING_API' | 'UNIFIED_ROUTING_API';
}

const UNISWAP_OFFICIAL_ROUTING_API_INFO: ChainSpecificRoutingAPIInfo = {
  url: 'https://uniswap-api.aperture.finance/v2/quote',
  type: 'UNIFIED_ROUTING_API',
};

export interface ChainInfo {
  uniswap_v3_factory: string;
  uniswap_v3_nonfungible_position_manager: string;
  aperture_uniswap_v3_automan: string;
  wrappedNativeCurrency: Token;
  routingApiInfo: ChainSpecificRoutingAPIInfo;
  // Automan maximum allowed gas deduction ceiling.
  maxGasCeiling: number;
  // Only populated for networks that have an Infura endpoint.
  infura_network_id?: string;
  // Only populated for networks that do not have an Infura endpoint.
  rpc_url?: string;
  // Only populated for networks with a CoinGecko asset platform ID.
  coingecko_asset_platform_id?: string;
  // Only populated for networks with a Uniswap subgraph URL.
  uniswap_subgraph_url?: string;
  // TODO: remove `whitelistedPools` and `whitelistedTokens` once the frontend is updated to allow all pools/tokens.
  // Only populated for networks with whitelisted pools.
  whitelistedPools?: Map<string, WhitelistedPool>;
  whitelistedTokens?: Map<string, Token>;
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
      '0x00000000Ede6d8D217c60f93191C060747324bca',
    ),
    wrappedNativeCurrency: new Token(
      ApertureSupportedChainId.GOERLI_TESTNET_CHAIN_ID,
      getAddress('0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6'),
      18,
      'WETH',
      'Wrapped Ether',
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
    routingApiInfo: UNISWAP_OFFICIAL_ROUTING_API_INFO,
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
    wrappedNativeCurrency: new Token(
      ApertureSupportedChainId.ARBITRUM_GOERLI_TESTNET_CHAIN_ID,
      getAddress('0xe39Ab88f8A4777030A534146A9Ca3B52bd5D43A3'),
      18,
      'WETH',
      'WETH',
    ),
    infura_network_id: 'arbitrum-goerli',
    maxGasCeiling: 0.05,
    routingApiInfo: UNISWAP_OFFICIAL_ROUTING_API_INFO,
  },
  [ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID]: {
    uniswap_v3_factory: getAddress(
      '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    ),
    uniswap_v3_nonfungible_position_manager: getAddress(
      '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    ),
    aperture_uniswap_v3_automan: getAddress(
      '0x00000000Ede6d8D217c60f93191C060747324bca',
    ),
    wrappedNativeCurrency: new Token(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
      18,
      'WETH',
      'Wrapped Ether',
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
    routingApiInfo: UNISWAP_OFFICIAL_ROUTING_API_INFO,
  },
  [ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID]: {
    uniswap_v3_factory: getAddress(
      '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    ),
    uniswap_v3_nonfungible_position_manager: getAddress(
      '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    ),
    aperture_uniswap_v3_automan: getAddress(
      '0x00000000Ede6d8D217c60f93191C060747324bca',
    ),
    wrappedNativeCurrency: new Token(
      ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID,
      getAddress('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
      18,
      'WETH',
      'Wrapped Ether',
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
    routingApiInfo: UNISWAP_OFFICIAL_ROUTING_API_INFO,
  },
};

export function getChainInfo(chainId: ApertureSupportedChainId) {
  return CHAIN_ID_TO_INFO[chainId];
}
