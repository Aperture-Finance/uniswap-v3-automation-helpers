import {
  Currency,
  CurrencyAmount,
  Percent,
  Price,
  Token,
} from '@uniswap/sdk-core';
import {
  FeeAmount,
  NonfungiblePositionManager,
  Position,
  TICK_SPACINGS,
  tickToPrice,
} from '@uniswap/v3-sdk';
import { UnsignedTransaction } from 'ethers';
import { Provider } from '@ethersproject/abstract-provider';
import { priceToClosestUsableTick } from './tick';
import { CHAIN_ID_TO_INFO } from './chain';
import { getNativeEther } from './currency';
import { getPoolFromBasicPositionInfo } from './pool';
import { BasicPositionInfo } from './position';
import JSBI from 'jsbi';

/**
 * Generates an unsigned transaction that creates a position for the specified limit order.
 * The position has single-sided liquidity entirely concentrated on the input asset, and will
 * be closed by automation when the entire liquidity moves to the output asset.
 * The initial single-sided liquidity will be provided over the smallest possible price range where
 * the higher end is `outerLimitPrice` which is expected to be aligned to a usable tick already.
 * Note that if the user wishes to sell ETH, then `limitPrice.baseCurrency` must be the WETH token,
 * but `inputCurrencyAmount.currency` should be either native ether or WETH token depending on which
 * the user chooses to provide.
 *
 * @param recipient The recipient address (connected wallet address).
 * @param outerLimitPrice The outer limit price where the base currency is the input asset (what the user wants to sell) and the quote currency is the output asset (what the user wants to buy).
 * @param inputCurrencyAmount The amount of input asset that the user wants to sell.
 * @param poolFee The fee tier of the liquidity pool that the limit order position should be created on.
 * @param deadlineEpochSeconds Transaction deadline in seconds since UNIX epoch.
 * @param provider Ethers provider.
 * @returns The unsigned transaction that creates such a position.
 */
export async function getCreatePositionTxForLimitOrder(
  recipient: string,
  outerLimitPrice: Price<Token, Token>,
  inputCurrencyAmount: CurrencyAmount<Currency>,
  poolFee: FeeAmount,
  deadlineEpochSeconds: number,
  provider: Provider,
): Promise<UnsignedTransaction> {
  const chainId = (await provider.getNetwork()).chainId;
  if (
    inputCurrencyAmount.currency.isNative &&
    !getNativeEther(chainId).wrapped.equals(outerLimitPrice.baseCurrency)
  ) {
    throw 'Input currency is native ether but base currency is not WETH';
  }
  const outerTick = priceToClosestUsableTick(outerLimitPrice, poolFee);
  if (
    !tickToPrice(
      outerLimitPrice.baseCurrency,
      outerLimitPrice.quoteCurrency,
      outerTick,
    ).equalTo(outerLimitPrice)
  ) {
    throw 'Outer limit price not aligned';
  }
  const tickSpacing = TICK_SPACINGS[poolFee];
  const zeroToOne = outerLimitPrice.baseCurrency.sortsBefore(
    outerLimitPrice.quoteCurrency,
  );
  const basicPositionInfo: BasicPositionInfo = {
    token0: outerLimitPrice.baseCurrency,
    token1: outerLimitPrice.quoteCurrency,
    tickLower: zeroToOne ? outerTick - tickSpacing : outerTick,
    tickUpper: zeroToOne ? outerTick : outerTick + tickSpacing,
    fee: poolFee,
  };
  const pool = await getPoolFromBasicPositionInfo(basicPositionInfo, provider);
  const position = zeroToOne
    ? Position.fromAmount0({
        pool,
        tickLower: basicPositionInfo.tickLower,
        tickUpper: basicPositionInfo.tickUpper,
        amount0: inputCurrencyAmount.quotient,
        useFullPrecision: true,
      })
    : Position.fromAmount1({
        pool,
        tickLower: basicPositionInfo.tickLower,
        tickUpper: basicPositionInfo.tickUpper,
        amount1: inputCurrencyAmount.quotient,
      });
  const { amount0, amount1 } = position.mintAmounts;
  if (
    (zeroToOne && JSBI.greaterThan(amount1, JSBI.BigInt(0))) ||
    (!zeroToOne && JSBI.greaterThan(amount0, JSBI.BigInt(0)))
  ) {
    throw 'Specified limit price lower than current price';
  }
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    position,
    {
      slippageTolerance: new Percent(0),
      deadline: deadlineEpochSeconds,
      useNative: inputCurrencyAmount.currency.isNative
        ? getNativeEther(chainId)
        : undefined,
      recipient,
    },
  );
  return {
    to: CHAIN_ID_TO_INFO.get(chainId)!.uniswap_v3_nonfungible_position_manager,
    data: calldata,
    value,
  };
}
