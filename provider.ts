import { providers } from '@0xsequence/multicall';
import { getChainInfo } from '@aperture_finance/uniswap-v3-automation-sdk';
import { ethers } from 'ethers';

/**
 * Creates a public ethers provider for the specified chain id.
 * @param chainId chain id must be supported by Aperture's UniV3 Automation platform.
 * @returns A multicall-wrapped public Infura provider.
 */
export function getPublicProvider(
  chainId: number,
): providers.MulticallProvider {
  const info = getChainInfo(chainId);
  const provider = info.infura_network_id
    ? new ethers.providers.InfuraProvider(info.infura_network_id)
    : new ethers.providers.JsonRpcProvider(info.rpc_url);
  return new providers.MulticallProvider(provider, {
    timeWindow: 0,
  });
}
