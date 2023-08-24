import {
  ApertureSupportedChainId,
  INonfungiblePositionManager,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider } from '@ethersproject/providers';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import { BigNumber, BigNumberish } from 'ethers';

import {
  encodeSwapData,
  getAutomanContract,
  simulateMintOptimal,
} from './automan';
import { getChainInfo } from './chain';
import { computePoolAddress } from './pool';

const ApiBaseUrl = 'https://api.1inch.dev';
const headers = {
  Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
  Accept: 'application/json',
};

type SwapParams = {
  src: string;
  dst: string;
  amount: string;
  from: string;
  slippage: number;
  disableEstimate: boolean;
  allowPartialFill: boolean;
};

const limiter = new Bottleneck({
  maxConcurrent: 1, // Number of concurrent promises
  minTime: 1500, // Minimum time (in ms) between the start of subsequent promises
});

function apiRequestUrl(chainId: ApertureSupportedChainId, methodName: string) {
  return new URL(`/swap/v5.2/${chainId}/${methodName}`, ApiBaseUrl).toString();
}

async function buildRequest(
  chainId: ApertureSupportedChainId,
  methodName: string,
  params: object,
) {
  return limiter.schedule(() =>
    axios.get(apiRequestUrl(chainId, methodName), {
      headers,
      params,
    }),
  );
}

export async function getApproveTarget(
  chainId: ApertureSupportedChainId,
): Promise<string> {
  try {
    return (await buildRequest(chainId, 'approve/spender', {})).data.address;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

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
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      (await buildRequest(chainId, 'swap', new URLSearchParams(swapParams)))
        .data
    );
  } catch (e) {
    console.error(e);
    throw e;
  }
}

/**
 * Get the optimal amount of liquidity to mint for a given pool and token amounts.
 * @param chainId The chain ID.
 * @param token0Amount The token0 amount.
 * @param token1Amount The token1 amount.
 * @param fee The pool fee tier.
 * @param tickLower The lower tick of the range.
 * @param tickUpper The upper tick of the range.
 * @param fromAddress The address to mint from.
 * @param slippage The slippage tolerance.
 * @param provider The Ethers provider.
 */
export async function optimalMint(
  chainId: ApertureSupportedChainId,
  token0Amount: CurrencyAmount<Token>,
  token1Amount: CurrencyAmount<Token>,
  fee: FeeAmount,
  tickLower: number,
  tickUpper: number,
  fromAddress: string,
  slippage: number,
  provider: JsonRpcProvider,
) {
  if (!token0Amount.currency.sortsBefore(token1Amount.currency)) {
    throw new Error('token0 must be sorted before token1');
  }
  const automan = getAutomanContract(chainId, provider);
  const mintParams = {
    token0: token0Amount.currency.address,
    token1: token1Amount.currency.address,
    fee,
    tickLower,
    tickUpper,
    amount0Desired: token0Amount.quotient.toString(),
    amount1Desired: token1Amount.quotient.toString(),
    amount0Min: 0,
    amount1Min: 0,
    recipient: fromAddress,
    deadline: Math.floor(Date.now() / 1000 + 60 * 30),
  };
  // get swap amounts using the same pool
  const {
    amountIn: poolAmountIn,
    amountOut: poolAmountOut,
    zeroForOne,
  } = await automan.getOptimalSwap(
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
  const { aperture_router_proxy } = getChainInfo(chainId);
  if (aperture_router_proxy === undefined) {
    return optimalMintPool(chainId, provider, fromAddress, mintParams);
  }
  const src = zeroForOne
    ? token0Amount.currency.address
    : token1Amount.currency.address;
  const dst = zeroForOne
    ? token1Amount.currency.address
    : token0Amount.currency.address;
  // get a quote from 1inch
  const initialQuote = await quote(
    chainId,
    src,
    dst,
    poolAmountIn.toString(),
    aperture_router_proxy,
    slippage,
  );
  console.log('poolAmountOut', poolAmountOut.toString());
  console.log('1inch quote', initialQuote.toAmount.toString());
  const poolEstimate = await optimalMintPool(
    chainId,
    provider,
    fromAddress,
    mintParams,
  );
  console.log(`poolEstimate liquidity: ${poolEstimate.liquidity.toString()}`);
  // use the same pool if the quote isn't better
  if (poolAmountOut.gte(initialQuote.toAmount)) {
    return poolEstimate;
  }
  // const approveTarget = await getApproveTarget(chainId);
  const approveTarget = '0x1111111254eeb25477b68fb85ed929f73a960582';
  // maximize the liquidity minted using 1inch and binary search
  let low = poolAmountIn.mul(8).div(10); // 0.8 * poolAmountIn
  let high = poolAmountIn.mul(12).div(10); // 1.2 * poolAmountIn
  let optimalSimulationResult;
  let optimalSwapData;
  let maxLiquidity = BigNumber.from(0);
  // 0.001 of the token unit
  const tolerance = BigNumber.from(10)
    .pow(
      zeroForOne
        ? token0Amount.currency.decimals
        : token1Amount.currency.decimals,
    )
    .div(1000);
  const maxIterations = 7;

  for (let i = 0; i < maxIterations && high.sub(low).gt(tolerance); i++) {
    const mid = low.add(high).div(2);
    // Get 1inch quote for this mid value
    const { swapData, simulationResult } = await searchStep(
      chainId,
      mintParams,
      src,
      dst,
      mid,
      approveTarget,
      fromAddress,
      slippage,
      provider,
    );
    console.log(
      `liquidity: ${simulationResult.liquidity.toString()}, low: ${low.toString()}, high: ${high.toString()}, mid: ${mid.toString()}`,
    );
    if (simulationResult.liquidity.gt(maxLiquidity)) {
      maxLiquidity = simulationResult.liquidity;
      optimalSwapData = swapData;
      optimalSimulationResult = simulationResult;
      low = mid.add(1);
    } else {
      high = mid.sub(1);
    }
  }
  return {
    amount0: optimalSimulationResult!.amount0,
    amount1: optimalSimulationResult!.amount1,
    liquidity: optimalSimulationResult!.liquidity,
    swapData: optimalSwapData,
  };
}

async function searchStep(
  chainId: ApertureSupportedChainId,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  src: string,
  dst: string,
  amountIn: BigNumberish,
  approveTarget: string,
  from: string,
  slippage: number,
  provider: JsonRpcProvider,
) {
  const quoteResult = await quote(
    chainId,
    src,
    dst,
    amountIn.toString(),
    getChainInfo(chainId).aperture_router_proxy!,
    slippage,
  );
  const swapData = encodeSwapData(
    chainId,
    quoteResult.tx.to,
    approveTarget,
    src,
    dst,
    amountIn,
    quoteResult.tx.data,
  );
  const simulationResult = await simulateMintOptimal(
    chainId,
    provider,
    from,
    mintParams,
    swapData,
  );
  return {
    swapData,
    simulationResult,
  };
}

async function optimalMintPool(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider,
  fromAddress: string,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
) {
  const { liquidity, amount0, amount1 } = await simulateMintOptimal(
    chainId,
    provider,
    fromAddress,
    mintParams,
  );
  return {
    amount0,
    amount1,
    liquidity,
    swapData: '0x',
  };
}

// export async function optimalRebalance(
//   chainId: ApertureSupportedChainId,
//   positionId: BigNumberish,
//   newTickLower: number,
//   newTickUpper: number,
//   provider: JsonRpcProvider,
// ) {}
