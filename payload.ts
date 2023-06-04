import {
  ActionTypeEnum,
  ApertureSupportedChainId,
  ConditionTypeEnum,
  CreateTriggerPayload,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { Currency, CurrencyAmount, Price, Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import { BigNumberish } from 'ethers';

export function generateLimitOrderCloseRequestPayload(
  ownerAddr: string,
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  outerLimitPrice: Price<Token, Token>,
  inputCurrencyAmount: CurrencyAmount<Currency>,
  feeTier: FeeAmount,
  maxGasProportion: number,
  expiration: number,
): CreateTriggerPayload {
  // Note that we should use `Token.sortsBefore()` to compare two tokens instead of directly comparing their addresses
  // because an address can be checksum-ed.
  const token0 = outerLimitPrice.baseCurrency.sortsBefore(
    outerLimitPrice.quoteCurrency,
  )
    ? outerLimitPrice.baseCurrency.address
    : outerLimitPrice.quoteCurrency.address;
  return {
    ownerAddr,
    chainId,
    expiration,
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
