import {
  INonfungiblePositionManager,
  PermitInfo,
  UniV3Automan,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { BigNumberish } from 'ethers';
import { splitSignature } from 'ethers/lib/utils';

const AUTOMAN_FRAGMENTS = [
  'removeLiquidity((uint256,uint128,uint256,uint256,uint256),uint256)',
  'removeLiquidity((uint256,uint128,uint256,uint256,uint256),uint256,uint256,uint8,bytes32,bytes32)',
  'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes)',
  'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes,uint256,uint8,bytes32,bytes32)',
  'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes)',
  'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes,uint256,uint8,bytes32,bytes32)',
] as const;
export type AutomanFragmentType = (typeof AUTOMAN_FRAGMENTS)[number];
export type AutomanParamTypesMap = {
  [P in AutomanFragmentType]: Parameters<UniV3Automan['functions'][P]>;
};
export type AutomanParamTypes = AutomanParamTypesMap[AutomanFragmentType];

export function getAutomanRebalanceCallInfo(
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  existingPositionId: BigNumberish,
  permitInfo?: PermitInfo,
): {
  functionFragment: AutomanFragmentType;
  values: AutomanParamTypes;
} {
  if (permitInfo === undefined) {
    return {
      functionFragment:
        'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes)',
      values: [
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
    values: [
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
): {
  functionFragment: AutomanFragmentType;
  values: AutomanParamTypes;
} {
  if (permitInfo === undefined) {
    return {
      functionFragment:
        'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes)',
      values: [increaseLiquidityParams, /*feeBips=*/ 0, /*swapData=*/ []],
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  return {
    functionFragment:
      'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes,uint256,uint8,bytes32,bytes32)',
    values: [
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
