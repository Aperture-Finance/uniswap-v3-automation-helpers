import { Payload } from '@aperture_finance/uniswap-v3-automation-sdk';
import { ApertureSupportedChainId } from './chain';
import { BigNumber } from 'ethers';
import { FeeAmount } from '@uniswap/v3-sdk';
import { Currency, CurrencyAmount, Price, Token } from '@uniswap/sdk-core';

export function generateLimitOrderCloseRequestPayload(
  ownerAddr: string,
  chainId: ApertureSupportedChainId,
  positionId: BigNumber,
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
    nftId: positionId.toNumber(),
    condition: {
      type: 'TokenAmount',
      zeroAmountToken: outerLimitPrice.baseCurrency.address === token0 ? 0 : 1,
    },
    action: {
      type: 'LimitOrderClose',
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
