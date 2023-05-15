import {
  INonfungiblePositionManager,
  PermitInfo,
  UniV3Automan,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { BigNumberish } from 'ethers';
import { splitSignature } from 'ethers/lib/utils';

export type AutomanActionName = 'removeLiquidity' | 'reinvest' | 'rebalance';
export type AutomanFragment = {
  [K in keyof UniV3Automan['functions']]: K extends `${AutomanActionName}${string}`
    ? K
    : never;
}[keyof UniV3Automan['functions']];
export type AutomanParams = {
  [P in AutomanFragment]: Parameters<UniV3Automan['functions'][P]>;
}[AutomanFragment];

export type AutomanCallInfo = {
  functionFragment: AutomanFragment;
  params: AutomanParams;
};

export function getAutomanRebalanceCallInfo(
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  existingPositionId: BigNumberish,
  permitInfo?: PermitInfo,
): AutomanCallInfo {
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
  increaseLiquidityParams: INonfungiblePositionManager.IncreaseLiquidityParamsStruct,
  permitInfo?: PermitInfo,
): AutomanCallInfo {
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
