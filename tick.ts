import { Price, Token } from '@uniswap/sdk-core';
import {
  FeeAmount,
  TICK_SPACINGS,
  TickMath,
  nearestUsableTick,
  priceToClosestTick,
  tickToPrice,
} from '@uniswap/v3-sdk';

/**
 * Finds the closest usable tick for the specified price and pool fee tier.
 * Price may be specified in either direction, i.e. price of token1 denominated in token0 and price of token0 denominated in token1 both work.
 * @param price Price of two tokens in the liquidity pool. Either token0 or token1 may be the base token.
 * @param poolFee Liquidity pool fee tier.
 * @returns The closest usable tick.
 */
export function priceToClosestUsableTick(
  price: Price<Token, Token>,
  poolFee: FeeAmount,
): number {
  let tick = priceToClosestTick(price);
  tick = Math.max(tick, TickMath.MIN_TICK);
  tick = Math.min(tick, TickMath.MAX_TICK);
  return nearestUsableTick(tick, TICK_SPACINGS[poolFee]);
}

/**
 * Aligns price to the closest usable tick and returns the aligned price.
 * @param price The price to align.
 * @param poolFee Liquidity pool fee tier.
 * @returns The aligned price.
 */
export function alignPriceToClosestUsableTick(
  price: Price<Token, Token>,
  poolFee: FeeAmount,
): Price<Token, Token> {
  return tickToPrice(
    price.baseCurrency,
    price.quoteCurrency,
    priceToClosestUsableTick(price, poolFee),
  );
}
