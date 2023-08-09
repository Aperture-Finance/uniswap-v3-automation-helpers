import {
  INonfungiblePositionManager,
  PermitInfo,
  UniV3Automan,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { BigNumberish } from 'ethers';
import { splitSignature } from 'ethers/lib/utils';

export type AutomanActionName = 'decreaseLiquidity' | 'reinvest' | 'rebalance';
export type AutomanFragment = {
  [K in keyof UniV3Automan['functions']]: K extends `${AutomanActionName}${string}`
    ? K
    : never;
}[keyof UniV3Automan['functions']];

type ExtractFragment<T extends AutomanActionName> = {
  [P in AutomanFragment]: P extends `${T}${string}` ? P : never;
}[AutomanFragment];

export type AutomanParamsMap = {
  [P in AutomanFragment]: Parameters<UniV3Automan['functions'][P]>;
};

export type AutomanCallInfo<T extends AutomanFragment> = {
  functionFragment: T;
  params: AutomanParamsMap[T];
};

export function getAutomanRebalanceCallInfo(
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  existingPositionId: BigNumberish,
  permitInfo?: PermitInfo,
): AutomanCallInfo<ExtractFragment<'rebalance'>> {
  if (permitInfo === undefined) {
    return {
      functionFragment:
        'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes)',
      params: [
        mintParams,
        existingPositionId,
        /*feeBips=*/ 0,
        /*swapData=*/ [],
      ],
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  return {
    functionFragment:
      'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes,uint256,uint8,bytes32,bytes32)',
    params: [
      mintParams,
      existingPositionId,
      /*feeBips=*/ 0,
      /*swapData=*/ [],
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
  permitInfo?: PermitInfo,
): AutomanCallInfo<ExtractFragment<'reinvest'>> {
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
      params: [increaseLiquidityParams, /*feeBips=*/ 0, /*swapData=*/ []],
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  return {
    functionFragment:
      'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes,uint256,uint8,bytes32,bytes32)',
    params: [
      increaseLiquidityParams,
      /*feeBips=*/ 0,
      /*swapData=*/ [],
      permitInfo.deadline,
      permitSignature.v,
      permitSignature.r,
      permitSignature.s,
    ],
  };
}
