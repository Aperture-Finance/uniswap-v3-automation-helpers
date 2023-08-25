import {
  ApertureSupportedChainId,
  INonfungiblePositionManager,
  IUniV3Automan__factory,
  PermitInfo,
  UniV3Automan,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { FeeAmount, TICK_SPACINGS, nearestUsableTick } from '@uniswap/v3-sdk';
import { BigNumberish, BytesLike, Signer } from 'ethers';
import { solidityPack, splitSignature } from 'ethers/lib/utils';

import { getChainInfo } from './chain';
import {
  getAutomanWhitelistOverrides,
  getTokenOverrides,
  staticCallWithOverrides,
} from './overrides';

export type AutomanActionName = 'decreaseLiquidity' | 'reinvest' | 'rebalance';
export type AutomanFragment = {
  [K in keyof UniV3Automan['functions']]: K extends `${AutomanActionName}${string}`
    ? K
    : never;
}[keyof UniV3Automan['functions']];

export type GetAutomanFragment<T extends AutomanActionName> = {
  [P in AutomanFragment]: P extends `${T}${string}` ? P : never;
}[AutomanFragment];

export type GetAutomanParams<T extends AutomanFragment> = Parameters<
  UniV3Automan['functions'][T]
>;

type AutomanCallInfo<T extends AutomanActionName> = {
  functionFragment: GetAutomanFragment<T>;
  params: GetAutomanParams<GetAutomanFragment<T>>;
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type MintReturnType = UnwrapPromise<
  ReturnType<UniV3Automan['callStatic']['mintOptimal']>
>;

export function getAutomanContract(
  chainId: ApertureSupportedChainId,
  provider: Provider | Signer,
) {
  return IUniV3Automan__factory.connect(
    getChainInfo(chainId).aperture_uniswap_v3_automan,
    provider,
  );
}

export function encodeSwapData(
  chainId: ApertureSupportedChainId,
  router: string,
  approveTarget: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: BigNumberish,
  data: BytesLike,
): string {
  return solidityPack(
    ['address', 'bytes'],
    [
      getChainInfo(chainId).aperture_router_proxy!,
      solidityPack(
        ['address', 'address', 'address', 'address', 'uint256', 'bytes'],
        [router, approveTarget, tokenIn, tokenOut, amountIn, data],
      ),
    ],
  );
}

export function getAutomanMintOptimalCalldata(
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  swapData: BytesLike = '0x',
): string {
  return IUniV3Automan__factory.createInterface().encodeFunctionData(
    'mintOptimal',
    [mintParams, swapData],
  );
}

/**
 * Simulate a `mintOptimal` call by overriding the balances and allowances of the tokens involved.
 * @param chainId The chain ID.
 * @param provider The Ethers provider.
 * @param from The address to simulate the call from.
 * @param mintParams The mint parameters.
 * @param swapData The swap data if using a router.
 * @param blockNumber Optional block number to query.
 * @returns {tokenId, liquidity, amount0, amount1}
 */
export async function simulateMintOptimal(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider,
  from: string,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  swapData?: BytesLike,
  blockNumber?: number,
): Promise<MintReturnType> {
  const tickLower = Number(mintParams.tickLower.toString());
  const tickUpper = Number(mintParams.tickUpper.toString());
  const fee = mintParams.fee as FeeAmount;
  if (
    tickLower !== nearestUsableTick(tickLower, TICK_SPACINGS[fee]) ||
    tickUpper !== nearestUsableTick(tickUpper, TICK_SPACINGS[fee])
  ) {
    throw new Error('tickLower or tickUpper not valid');
  }
  const data = getAutomanMintOptimalCalldata(mintParams, swapData);
  const { aperture_uniswap_v3_automan, aperture_router_proxy } =
    getChainInfo(chainId);
  const returnData = await staticCallWithOverrides(
    {
      from,
      to: aperture_uniswap_v3_automan,
      data,
    },
    // forge token approvals and balances
    {
      ...(aperture_router_proxy ? getAutomanWhitelistOverrides(chainId) : {}),
      ...(await getTokenOverrides(
        chainId,
        provider,
        from,
        mintParams.token0,
        mintParams.token1,
        mintParams.amount0Desired,
        mintParams.amount1Desired,
      )),
    },
    provider,
    blockNumber,
  );
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    'mintOptimal',
    returnData,
  ) as unknown as MintReturnType;
}

export function getAutomanRebalanceCallInfo(
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  existingPositionId: BigNumberish,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
  swapData: BytesLike = '0x',
): AutomanCallInfo<'rebalance'> {
  if (permitInfo === undefined) {
    return {
      functionFragment:
        'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes)',
      params: [mintParams, existingPositionId, feeBips, swapData],
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  return {
    functionFragment:
      'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes,uint256,uint8,bytes32,bytes32)',
    params: [
      mintParams,
      existingPositionId,
      feeBips,
      swapData,
      permitInfo.deadline,
      permitSignature.v,
      permitSignature.r,
      permitSignature.s,
    ],
  };
}

export function getAutomanReinvestCallInfo(
  positionId: BigNumberish,
  deadline: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
  swapData: BytesLike = '0x',
): AutomanCallInfo<'reinvest'> {
  const increaseLiquidityParams: INonfungiblePositionManager.IncreaseLiquidityParamsStruct =
    {
      tokenId: positionId,
      amount0Desired: 0, // Param value ignored by Automan.
      amount1Desired: 0, // Param value ignored by Automan.
      amount0Min,
      amount1Min,
      deadline,
    };
  if (permitInfo === undefined) {
    return {
      functionFragment:
        'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes)',
      params: [increaseLiquidityParams, feeBips, swapData],
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  return {
    functionFragment:
      'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes,uint256,uint8,bytes32,bytes32)',
    params: [
      increaseLiquidityParams,
      feeBips,
      swapData,
      permitInfo.deadline,
      permitSignature.v,
      permitSignature.r,
      permitSignature.s,
    ],
  };
}
