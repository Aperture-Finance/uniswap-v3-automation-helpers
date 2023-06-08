import { Price, Token } from '@uniswap/sdk-core';
import axios from 'axios';
import JSBI from 'jsbi';
import { getChainInfo } from './chain';
import Big from 'big.js';
import { TickMath } from '@uniswap/v3-sdk';

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
    JSBI.exponentiate(
      JSBI.BigInt(10),
      JSBI.BigInt(decimals + baseToken.decimals),
    ),
    JSBI.multiply(
      withoutDecimals,
      JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(quoteToken.decimals)),
    ),
  );
}

/**
 * Fetches the specified token's current USD price from Coingecko.
 * @param token The token to fetch price information for.
 * @returns The token's current USD price as a number. For example, USDC's price may be 0.999695.
 */
export async function getTokenUSDPriceFromCoingecko(
  token: Token,
): Promise<number> {
  const chainInfo = getChainInfo(token.chainId);
  if (chainInfo.coingecko_asset_platform_id === undefined) return 0;
  const priceResponse = await axios.get(
    `https://api.coingecko.com/api/v3/simple/token_price/${chainInfo.coingecko_asset_platform_id}?contract_addresses=${token.address}&vs_currencies=usd`,
  );
  // Coingecko call example: https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&vs_currencies=usd
  return priceResponse.data[token.address.toLowerCase()]['usd'];
}

/**
 * For a given tick range from `tickLower` to `tickUpper`, and a given proportion of the value of the position that is held in token0,
 * calculate the raw price of token0 denominated in token1.
 * @param tickLower The lower tick of the range.
 * @param tickUpper The upper tick of the range.
 * @param token0ValueProportion The proportion of the value of the position that is held in token0, as a `Big` number between 0 and 1, inclusive.
 * @returns The raw price of token0 denominated in token1 for the specified tick range and token0 value proportion.
 */
export function getRawRelativePriceFromTokenValueProportion(
  tickLower: number,
  tickUpper: number,
  token0ValueProportion: Big,
): Big {
  if (token0ValueProportion.lt(0) || token0ValueProportion.gt(1)) {
    throw new Error(
      'Invalid token0ValueProportion: must be a value between 0 and 1, inclusive',
    );
  }
  const sqrtRatioAtTickLowerX96 = TickMath.getSqrtRatioAtTick(tickLower);
  const sqrtRatioAtTickUpperX96 = TickMath.getSqrtRatioAtTick(tickUpper);
  // Let Big use 30 decimal places of precision since 2^96 < 10^29.
  Big.DP = 30;
  const scale = new Big('2').pow(96);
  const L = new Big(sqrtRatioAtTickLowerX96.toString()).div(scale);
  const U = new Big(sqrtRatioAtTickUpperX96.toString()).div(scale);
  return U.minus(token0ValueProportion.times(U).times(2))
    .add(
      U.times(
        token0ValueProportion
          .times(L)
          .times(-4)
          .times(token0ValueProportion.sub(1))
          .add(U.times(token0ValueProportion.times(-2).add(1).pow(2))),
      ).sqrt(),
    )
    .div(token0ValueProportion.times(-2).add(2))
    .pow(2);
}
