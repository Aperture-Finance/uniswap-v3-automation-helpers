import { Price, Token } from '@uniswap/sdk-core';
import JSBI from 'jsbi';

/**
 * Parses the specified price string for the price of `baseToken` denominated in `quoteToken`.
 * As an example, if `baseToken` is WBTC and `quoteToken` is WETH, then the "10.23" price string represents the exchange ratio of "1 WBTC = 10.23 WETH".
 * In general, `price` amount of `quoteToken` is worth the same as 1 human-unit of `baseToken`.
 * Internally, price is represented as the amount of raw `quoteToken` that is worth the same as 1 raw `baseToken`:
 * 1 raw WBTC = 10^(-8) WBTC = 10^(-8) * 10.23 WETH = 10^(-8) * 10.23 * 10^18 raw WETH = 10.23 * 10^(18-10) raw WETH.
 * Adapted from https://github.com/Uniswap/interface/blob/c2a972eb75d176f3f1a8ca24bb97cdaa4379cbd5/src/state/mint/v3/utils.ts#L12.
 * @param baseToken base token
 * @param quoteToken quote token
 * @param price What amount of `quoteToken` is worth the same as 1 baseToken
 * @returns The parsed price as an instance of Uniswap SDK Price.
 */
export function parsePrice(
  baseToken: Token,
  quoteToken: Token,
  price: string,
): Price<Token, Token> {
  // Check whether `price` is a valid string of decimal number.
  // This regex matches any number of digits optionally followed by '.' which is then followed by at least one digit.
  if (!price.match(/^\d*\.?\d+$/)) {
    throw 'Invalid price string';
  }

  const [whole, fraction] = price.split('.');
  const decimals = fraction?.length ?? 0;
  const withoutDecimals = JSBI.BigInt((whole ?? '') + (fraction ?? ''));
  return new Price(
    baseToken,
    quoteToken,
    JSBI.multiply(
      JSBI.BigInt(10 ** decimals),
      JSBI.BigInt(10 ** baseToken.decimals),
    ),
    JSBI.multiply(withoutDecimals, JSBI.BigInt(10 ** quoteToken.decimals)),
  );
}
