import {
  ActionTypeEnum,
  ApertureSupportedChainId,
  ConditionTypeEnum,
  CreateTriggerPayload,
  PriceCondition,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { Price, Token } from '@uniswap/sdk-core';
import { TickMath } from '@uniswap/v3-sdk';
import Big, { BigSource } from 'big.js';
import { BigNumberish } from 'ethers';
import JSBI from 'jsbi';

import { getRawRelativePriceFromTokenValueProportion } from './price';

export function generateLimitOrderCloseRequestPayload(
  ownerAddr: string,
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  outerLimitPrice: Price<Token, Token>,
  maxGasProportion: number,
  expiration: number,
): CreateTriggerPayload {
  // Note that we should use `Token.sortsBefore()` to compare two tokens instead of directly comparing their addresses
  // because an address can be checksum-ed.
  return {
    ownerAddr,
    chainId,
    expiration,
    nftId: positionId.toString(),
    condition: {
      type: ConditionTypeEnum.enum.TokenAmount,
      zeroAmountToken: outerLimitPrice.baseCurrency.sortsBefore(
        outerLimitPrice.quoteCurrency,
      )
        ? 0
        : 1,
    },
    action: {
      type: ActionTypeEnum.enum.LimitOrderClose,
      inputTokenAddr: outerLimitPrice.baseCurrency.address,
      maxGasProportion,
    },
  };
}

export function generateAutoCompoundRequestPayload(
  ownerAddr: string,
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  feeToPrincipalRatioThreshold: number,
  slippage: number,
  maxGasProportion: number,
  expiration: number,
): CreateTriggerPayload {
  return {
    ownerAddr,
    chainId,
    expiration,
    nftId: positionId.toString(),
    condition: {
      type: ConditionTypeEnum.enum.AccruedFees,
      feeToPrincipalRatioThreshold,
    },
    action: {
      type: ActionTypeEnum.enum.Reinvest,
      slippage,
      maxGasProportion,
    },
  };
}

export function generatePriceConditionFromTokenValueProportion(
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
  token0ValueProportion: BigSource,
  durationSec?: number,
): PriceCondition {
  const priceThreshold = getRawRelativePriceFromTokenValueProportion(
    tickLower,
    tickUpper,
    new Big(token0ValueProportion),
  );
  const tickTreshold = TickMath.getTickAtSqrtRatio(
    JSBI.BigInt(
      priceThreshold.sqrt().mul(new Big(2).pow(96)).toFixed(0).toString(),
    ),
  );
  let lte: string | undefined, gte: string | undefined;
  if (tickTreshold > tickCurrent) {
    gte = priceThreshold.toString();
  } else {
    lte = priceThreshold.toString();
  }
  return {
    type: ConditionTypeEnum.enum.Price,
    lte,
    gte,
    durationSec,
  };
}
