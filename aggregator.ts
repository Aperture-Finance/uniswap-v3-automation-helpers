import {
  ApertureSupportedChainId,
  INonfungiblePositionManager,
  getChainInfo,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import axios from 'axios';
import Bottleneck from 'bottleneck';
import { BigNumberish } from 'ethers';

import {
  encodeOptimalSwapData,
  encodeSwapData,
  getAutomanContract,
  simulateDecreaseLiquiditySingle,
  simulateMintOptimal,
  simulateRebalance,
  simulateRemoveLiquidity,
} from './automan';
import { StateOverrides, getERC20Overrides } from './overrides';
import { computePoolAddress } from './pool';
import { PositionDetails } from './position';

const ApiBaseUrl = 'https://1inch-api.aperture.finance';
const headers = {
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

/**
 * Get a quote for a swap.
 * @param chainId The chain ID.
 * @param src Contract address of a token to sell
 * @param dst Contract address of a token to buy
 * @param amount Amount of a token to sell, set in minimal divisible units
 * @param from Address of a seller, make sure that this address has approved to spend src in needed amount
 * @param slippage Limit of price slippage you are willing to accept in percentage
 */
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
 * @param provider A JSON RPC provider or a base provider.
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
  provider: JsonRpcProvider | Provider,
) {
  if (!token0Amount.currency.sortsBefore(token1Amount.currency)) {
    throw new Error('token0 must be sorted before token1');
  }
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
    deadline: Math.floor(Date.now() / 1000 + 86400),
  };
  const { aperture_uniswap_v3_automan, optimal_swap_router } =
    getChainInfo(chainId);
  let overrides: StateOverrides | undefined;
  if (provider instanceof JsonRpcProvider) {
    // forge token approvals and balances
    const [token0Overrides, token1Overrides] = await Promise.all([
      getERC20Overrides(
        mintParams.token0,
        fromAddress,
        aperture_uniswap_v3_automan,
        mintParams.amount0Desired,
        provider,
      ),
      getERC20Overrides(
        mintParams.token1,
        fromAddress,
        aperture_uniswap_v3_automan,
        mintParams.amount1Desired,
        provider,
      ),
    ]);
    overrides = {
      ...token0Overrides,
      ...token1Overrides,
    };
  }
  const poolPromise = optimalMintPool(
    chainId,
    provider,
    fromAddress,
    mintParams,
    overrides,
  );
  if (optimal_swap_router === undefined) {
    return await poolPromise;
  }
  const [poolEstimate, routerEstimate] = await Promise.all([
    poolPromise,
    optimalMintRouter(
      chainId,
      provider,
      fromAddress,
      mintParams,
      slippage,
      overrides,
    ),
  ]);
  // use the same pool if the quote isn't better
  if (poolEstimate.liquidity.gte(routerEstimate.liquidity)) {
    return poolEstimate;
  } else {
    return routerEstimate;
  }
}

async function optimalMintPool(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  fromAddress: string,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  overrides?: StateOverrides,
) {
  const { amount0, amount1, liquidity } = await simulateMintOptimal(
    chainId,
    provider,
    fromAddress,
    mintParams,
    undefined,
    undefined,
    overrides,
  );
  return {
    amount0,
    amount1,
    liquidity,
    swapData: '0x',
  };
}

async function getOptimalMintSwapData(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  slippage: number,
) {
  const { optimal_swap_router, uniswap_v3_factory } = getChainInfo(chainId);
  const automan = getAutomanContract(chainId, provider);
  const approveTarget = await getApproveTarget(chainId);
  // get swap amounts using the same pool
  const { amountIn: poolAmountIn, zeroForOne } = await automan.getOptimalSwap(
    computePoolAddress(
      uniswap_v3_factory,
      mintParams.token0,
      mintParams.token1,
      mintParams.fee as FeeAmount,
    ),
    mintParams.tickLower,
    mintParams.tickUpper,
    mintParams.amount0Desired,
    mintParams.amount1Desired,
  );
  // get a quote from 1inch
  const { tx } = await quote(
    chainId,
    zeroForOne ? mintParams.token0 : mintParams.token1,
    zeroForOne ? mintParams.token1 : mintParams.token0,
    poolAmountIn.toString(),
    optimal_swap_router!,
    slippage * 100,
  );
  return encodeOptimalSwapData(
    chainId,
    mintParams.token0,
    mintParams.token1,
    mintParams.fee as FeeAmount,
    mintParams.tickLower as number,
    mintParams.tickUpper as number,
    zeroForOne,
    approveTarget,
    tx.to,
    tx.data,
  );
}

async function optimalMintRouter(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  fromAddress: string,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  slippage: number,
  overrides?: StateOverrides,
) {
  const swapData = await getOptimalMintSwapData(
    chainId,
    provider,
    mintParams,
    slippage,
  );
  const { amount0, amount1, liquidity } = await simulateMintOptimal(
    chainId,
    provider,
    fromAddress,
    mintParams,
    swapData,
    undefined,
    overrides,
  );
  return {
    amount0,
    amount1,
    liquidity,
    swapData,
  };
}

export async function optimalRebalance(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  newTickLower: number,
  newTickUpper: number,
  feeBips: BigNumberish,
  usePool: boolean,
  fromAddress: string,
  slippage: number,
  provider: JsonRpcProvider | Provider,
) {
  const position = await PositionDetails.fromPositionId(
    chainId,
    positionId,
    provider,
  );
  const { amount0: receive0, amount1: receive1 } =
    await simulateRemoveLiquidity(
      chainId,
      provider,
      fromAddress,
      position.owner,
      position.tokenId,
      0,
      0,
      feeBips,
    );
  const mintParams: INonfungiblePositionManager.MintParamsStruct = {
    token0: position.token0.address,
    token1: position.token1.address,
    fee: position.fee,
    tickLower: newTickLower,
    tickUpper: newTickUpper,
    amount0Desired: receive0,
    amount1Desired: receive1,
    amount0Min: 0, // Setting this to zero for tx simulation.
    amount1Min: 0, // Setting this to zero for tx simulation.
    recipient: fromAddress, // Param value ignored by Automan for rebalance.
    deadline: Math.floor(Date.now() / 1000 + 86400),
  };
  let swapData = '0x';
  if (!usePool) {
    try {
      swapData = await getOptimalMintSwapData(
        chainId,
        provider,
        mintParams,
        slippage,
      );
    } catch (e) {
      console.error(`Failed to get swap data: ${e}`);
    }
  }
  const { amount0, amount1, liquidity } = await simulateRebalance(
    chainId,
    provider,
    fromAddress,
    position.owner,
    mintParams,
    positionId,
    feeBips,
    swapData,
  );
  return {
    amount0,
    amount1,
    liquidity,
    swapData,
  };
}

async function getZapOutSwapData(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  fromAddress: string,
  position: PositionDetails,
  feeBips: BigNumberish,
  zeroForOne: boolean,
  slippage: number,
) {
  let swapData = '0x';
  try {
    const { amount0, amount1 } = await simulateRemoveLiquidity(
      chainId,
      provider,
      fromAddress,
      position.owner,
      position.tokenId,
      0,
      0,
      feeBips,
    );
    const tokenIn = zeroForOne
      ? position.token0.address
      : position.token1.address;
    const tokenOut = zeroForOne
      ? position.token1.address
      : position.token0.address;
    const amountIn = zeroForOne ? amount0.toString() : amount1.toString();
    // get a quote from 1inch
    const { tx } = await quote(
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      getChainInfo(chainId).aperture_router_proxy!,
      slippage * 100,
    );
    const approveTarget = await getApproveTarget(chainId);
    swapData = encodeSwapData(
      chainId,
      tx.to,
      approveTarget,
      tokenIn,
      tokenOut,
      amountIn,
      tx.data,
    );
  } catch (e) {
    console.error(`Failed to get swap data: ${e}`);
  }
  return swapData;
}

async function poolZapOut(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  fromAddress: string,
  position: PositionDetails,
  feeBips: BigNumberish,
  zeroForOne: boolean,
) {
  const amount = await simulateDecreaseLiquiditySingle(
    chainId,
    provider,
    fromAddress,
    position.owner,
    position.tokenId,
    position.liquidity,
    zeroForOne,
    0,
    feeBips,
  );
  return {
    amount,
    swapData: '0x',
  };
}

async function routerZapOut(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  fromAddress: string,
  position: PositionDetails,
  feeBips: BigNumberish,
  zeroForOne: boolean,
  slippage: number,
) {
  const swapData = await getZapOutSwapData(
    chainId,
    provider,
    fromAddress,
    position,
    feeBips,
    zeroForOne,
    slippage,
  );
  const amount = await simulateDecreaseLiquiditySingle(
    chainId,
    provider,
    fromAddress,
    position.owner,
    position.tokenId,
    position.liquidity,
    zeroForOne,
    0,
    feeBips,
    swapData,
  );
  return {
    amount,
    swapData,
  };
}

/**
 * Get the optimal amount of tokens to zap out of a position.
 * @param chainId The chain ID.
 * @param positionId The position ID.
 * @param zeroForOne Whether to swap token0 for token1 or vice versa.
 * @param feeBips The percentage of position value to pay as a fee, multiplied by 1e18.
 * @param fromAddress The address of the caller.
 * @param slippage The slippage tolerance.
 * @param provider A JSON RPC provider or a base provider.
 */
export async function optimalZapOut(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  zeroForOne: boolean,
  feeBips: BigNumberish,
  fromAddress: string,
  slippage: number,
  provider: JsonRpcProvider | Provider,
) {
  const position = await PositionDetails.fromPositionId(
    chainId,
    positionId,
    provider,
  );
  const poolPromise = poolZapOut(
    chainId,
    provider,
    fromAddress,
    position,
    feeBips,
    zeroForOne,
  );
  if (getChainInfo(chainId).aperture_router_proxy === undefined) {
    return await poolPromise;
  }
  const [poolEstimate, routerEstimate] = await Promise.all([
    poolPromise,
    routerZapOut(
      chainId,
      provider,
      fromAddress,
      position,
      feeBips,
      zeroForOne,
      slippage,
    ),
  ]);
  // use the same pool if the quote isn't better
  if (poolEstimate.amount.gte(routerEstimate.amount)) {
    return poolEstimate;
  } else {
    return routerEstimate;
  }
}
