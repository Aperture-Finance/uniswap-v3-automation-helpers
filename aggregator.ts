import { ApertureSupportedChainId } from '@aperture_finance/uniswap-v3-automation-sdk';
import { Provider } from '@ethersproject/providers';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import axios from 'axios';
import {BigNumber, BigNumberish} from 'ethers';

import { getAutomanContract } from './automan';
import { getChainInfo } from './chain';
import { computePoolAddress } from './pool';

const ApiBaseUrl = 'https://api.1inch.io/v5.2';

type SwapParams = {
  src: string;
  dst: string;
  amount: string;
  from: string;
  slippage: number;
  disableEstimate: boolean;
  allowPartialFill: boolean;
};

export async function quote(
  chainId: ApertureSupportedChainId,
  src: string,
  dst: string,
  amount: string,
  from: string,
  slippage: number,
): Promise<{
  toAmount: string;
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gas: string;
    gasPrice: string;
  };
}> {
  const swapParams: SwapParams = {
    src,
    dst,
    amount,
    from,
    slippage,
    disableEstimate: true,
    allowPartialFill: false,
  };
  try {
    return (
      await axios.get(new URL(`/${chainId}/quote`, ApiBaseUrl).toString(), {
        params: new URLSearchParams(swapParams),
      })
    ).data;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export async function optimalMint(
  chainId: ApertureSupportedChainId,
  token0Amount: CurrencyAmount<Token>,
  token1Amount: CurrencyAmount<Token>,
  fee: FeeAmount,
  tickLower: number,
  tickUpper: number,
  fromAddress: string,
  slippage: number,
  provider: Provider,
) {
  const automan = getAutomanContract(chainId, provider);
  // get swap amounts using the same pool
  const { amountIn, amountOut, zeroForOne } = await automan.getOptimalSwap(
    computePoolAddress(
      getChainInfo(chainId).uniswap_v3_factory,
      token0Amount.currency.address,
      token1Amount.currency.address,
      fee,
    ),
    tickLower,
    tickUpper,
    token0Amount.quotient.toString(),
    token1Amount.quotient.toString(),
  );
  // get a quote from 1inch
  const { toAmount, tx } = await quote(
    chainId,
    zeroForOne ? token0Amount.currency.address : token1Amount.currency.address,
    zeroForOne ? token1Amount.currency.address : token0Amount.currency.address,
    amountIn.toString(),
    fromAddress,
    slippage,
  );
  // use the same pool if the quote isn't better
  if (amountOut.gte(toAmount) {
    return {
      amount0,
      amount1,
      liquidity,
      swapData,
    }
  }
}

export async function optimalRebalance(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  newTickLower: number,
  newTickUpper: number,
  provider: Provider,
) {}
