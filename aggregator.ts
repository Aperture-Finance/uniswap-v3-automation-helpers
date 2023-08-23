import {
  ApertureSupportedChainId,
  INonfungiblePositionManager,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider } from '@ethersproject/providers';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import { FeeAmount } from '@uniswap/v3-sdk';
import axios from 'axios';

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

function apiRequestUrl(chainId: ApertureSupportedChainId, methodName: string) {
  return new URL(`/swap/v5.2/${chainId}/${methodName}`, ApiBaseUrl).toString();
}

export async function getApproveTarget(
  chainId: ApertureSupportedChainId,
): Promise<string> {
  try {
    return (
      await axios.get(apiRequestUrl(chainId, 'approve/spender'), {
        headers,
      })
    ).data.address;
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
      await axios.get(apiRequestUrl(chainId, 'swap'), {
        headers,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
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
  const { toAmount: routerAmountOut, tx } = await quote(
    chainId,
    src,
    dst,
    poolAmountIn.toString(),
    aperture_router_proxy,
    slippage,
  );
  console.log('poolAmountOut', poolAmountOut.toString());
  console.log('1inch quote', routerAmountOut.toString());
  // use the same pool if the quote isn't better
  if (poolAmountOut.gte(routerAmountOut)) {
    return optimalMintPool(chainId, provider, fromAddress, mintParams);
  }
  // const approveTarget = await getApproveTarget(chainId);
  const approveTarget = '0x1111111254eeb25477b68fb85ed929f73a960582';
  const swapData = encodeSwapData(
    chainId,
    tx.to,
    approveTarget,
    src,
    dst,
    poolAmountIn,
    tx.data,
  );
  const { liquidity, amount0, amount1 } = await simulateMintOptimal(
    chainId,
    provider,
    fromAddress,
    mintParams,
    swapData,
  );
  return {
    amount0,
    amount1,
    liquidity,
    swapData,
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
