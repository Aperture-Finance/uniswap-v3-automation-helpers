import { ethers } from 'ethers';
import { providers } from '@0xsequence/multicall';
import { CHAIN_ID_TO_INFO } from './chain';

/**
 * Creates a public ethers provider for the specified chain id.
 * @param chainId chain id must be supported by Aperture's UniV3 Automation platform.
 * @returns A muticall-wrapped public Infura provider.
 */
export function getPublicProvider(
  chainId: number,
): providers.MulticallProvider {
  return new providers.MulticallProvider(
    new ethers.providers.InfuraProvider(
      CHAIN_ID_TO_INFO.get(chainId)!.infura_network_id!,
    ),
  );
}
