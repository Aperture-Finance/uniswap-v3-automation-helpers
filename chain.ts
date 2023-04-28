import { getAddress } from 'ethers';

export type ChainId = number;
export const ETHEREUM_MAINNET_CHAIN_ID: ChainId = 1;
export const ARBITRUM_MAINNET_CHAIN_ID: ChainId = 42161;
export const GOERLI_TESTNET_CHAIN_ID: ChainId = 5;

export interface ChainInfo {
  uniswap_v3_factory: string;
  uniswap_v3_nonfungible_position_manager: string;
  aperture_uniswap_v3_automan: string;
  coingecko_asset_platform_id?: string; // See https://api.coingecko.com/api/v3/asset_platforms.
  infura_network_id?: string;
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
        '0xE81df2Fc4f54D96e5f209e2D135f34E75725f34f',
      ),
      infura_network_id: 'goerli',
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
    },
  ],
]);
