import {
  ActionTypeEnum,
  ApertureSupportedChainId,
  ConditionTypeEnum,
  Payload,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { BigNumberish } from 'ethers';
import { FeeAmount } from '@uniswap/v3-sdk';
import { Currency, CurrencyAmount, Price, Token } from '@uniswap/sdk-core';

export function generateLimitOrderCloseRequestPayload(
  ownerAddr: string,
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  outerLimitPrice: Price<Token, Token>,
  inputCurrencyAmount: CurrencyAmount<Currency>,
  feeTier: FeeAmount,
  maxGasProportion: number,
): Payload {
  const token0 = [
    outerLimitPrice.baseCurrency.address,
    outerLimitPrice.quoteCurrency.address,
  ].sort()[0];
  return {
    ownerAddr,
    chainId,
    nftId: positionId.toString(),
    condition: {
      type: ConditionTypeEnum.enum.TokenAmount,
      zeroAmountToken: outerLimitPrice.baseCurrency.address === token0 ? 0 : 1,
    },
    action: {
      type: ActionTypeEnum.enum.LimitOrderClose,
      inputTokenAmount: {
        address: outerLimitPrice.baseCurrency.address,
        rawAmount: inputCurrencyAmount.quotient.toString(),
      },
      outputTokenAddr: outerLimitPrice.quoteCurrency.address,
      feeTier,
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
): Payload {
  return {
    ownerAddr,
    chainId,
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
