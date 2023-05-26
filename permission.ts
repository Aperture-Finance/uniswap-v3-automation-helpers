import { BigNumberish, TypedDataDomain, TypedDataField, ethers } from 'ethers';
import { Provider } from '@ethersproject/abstract-provider';
import { INonfungiblePositionManager__factory } from '@aperture_finance/uniswap-v3-automation-sdk/typechain-types';
import {
  ApertureSupportedChainId,
  PermitInfo,
} from '@aperture_finance/uniswap-v3-automation-sdk/interfaces';
import { getChainInfo } from './chain';

export interface PositionApprovalStatus {
  hasAuthority: boolean;
  owner: string;
  reason: string;
  error?: Error | unknown;
}

/**
 * Checks whether Aperture's UniV3Automan contract has authority over the specified position.
 * @param positionId Position id.
 * @param permitInfo If defined and Automan has not already been approved on-chain, this `permitInfo` will be validated as the last option.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns An PositionApprovalStatus object representing approval status.
 */
export async function checkPositionApprovalStatus(
  positionId: BigNumberish,
  permitInfo: PermitInfo | undefined,
  chainId: ApertureSupportedChainId,
  provider: ethers.providers.Provider,
): Promise<PositionApprovalStatus> {
  const chainInfo = getChainInfo(chainId);
  const npm = INonfungiblePositionManager__factory.connect(
    chainInfo.uniswap_v3_nonfungible_position_manager,
    provider,
  );
  const [owner, approved] = await Promise.all([
    npm.ownerOf(positionId),
    npm.getApproved(positionId),
  ]);
  if (approved == chainInfo.aperture_uniswap_v3_automan) {
    return {
      owner,
      hasAuthority: true,
      reason: 'onChainPositionSpecificApproval',
    };
  }
  const automanIsOperator = await npm.isApprovedForAll(
    owner,
    chainInfo.aperture_uniswap_v3_automan,
  );
  if (automanIsOperator) {
    return {
      owner,
      hasAuthority: true,
      reason: 'onChainUserLevelApproval',
    };
  }
  if (permitInfo === undefined) {
    return {
      owner,
      hasAuthority: false,
      reason: 'missingSignedPermission',
    };
  }
  try {
    const permitSignature = ethers.utils.splitSignature(permitInfo.signature);
    await npm.callStatic.permit(
      chainInfo.aperture_uniswap_v3_automan,
      positionId,
      permitInfo.deadline,
      permitSignature.v,
      permitSignature.r,
      permitSignature.s,
    );
    return {
      owner,
      hasAuthority: true,
      reason: 'offChainPositionSpecificApproval',
    };
  } catch (err) {
    return {
      owner,
      hasAuthority: false,
      reason: 'invalidSignedPermission',
      error: err,
    };
  }
}

/**
 * Generates typed data to be signed that allows Aperture's UniV3Automan contract to operate the specified position until the specified deadline.
 * @param chainId Chain id.
 * @param positionId Id of the position to generate permission for.
 * @param deadlineEpochSeconds The signed permission will be valid until this deadline specified in number of seconds since UNIX epoch.
 * @param provider Ethers provider.
 * @returns An object containing typed data ready to be signed with, for example, ethers `Wallet._signTypedData(domain, types, value)`.
 */
export async function generateTypedDataForPermit(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  deadlineEpochSeconds: BigNumberish,
  provider: Provider,
): Promise<{
  domain: TypedDataDomain;
  types: Record<string, Array<TypedDataField>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: Record<string, any>;
}> {
  const chainInfo = getChainInfo(chainId);
  return {
    domain: {
      name: 'Uniswap V3 Positions NFT-V1',
      version: '1',
      chainId,
      verifyingContract: chainInfo.uniswap_v3_nonfungible_position_manager,
    },
    types: {
      Permit: [
        { name: 'spender', type: 'address' },
        { name: 'tokenId', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    value: {
      spender: chainInfo.aperture_uniswap_v3_automan,
      tokenId: positionId,
      nonce: (
        await INonfungiblePositionManager__factory.connect(
          chainInfo.uniswap_v3_nonfungible_position_manager,
          provider,
        ).positions(positionId)
      ).nonce,
      deadline: deadlineEpochSeconds,
    },
  };
}
