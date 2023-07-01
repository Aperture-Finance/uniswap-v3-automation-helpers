import { Price, Token } from '@uniswap/sdk-core';
import { SqrtPriceMath, TickMath } from '@uniswap/v3-sdk';
import axios from 'axios';
import Big from 'big.js';
import JSBI from 'jsbi';

import { getChainInfo } from './chain';

// Let Big use 30 decimal places of precision since 2^96 < 10^29.
Big.DP = 30;
const Q96 = new Big('2').pow(96);

/**
 * Parses the specified price string for the price of `baseToken` denominated in `quoteToken`.
 * As an example, if `baseToken` is WBTC and `quoteToken` is WETH, then the "10.23" price string represents the exchange
 * ratio of "1 WBTC = 10.23 WETH".
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
 * Fetches tokens' current USD price from Coingecko in a batch.
 * @param tokens The tokens to fetch price information for.
 * @returns The tokens' current USD price. For example,
 * {
 *    0xbe9895146f7af43049ca1c1ae358b0541ea49704: 1783.17,
 *    0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce: 0.00000681
 * }
 */
export async function getTokenUSDPriceListFromCoingecko(
  tokens: Token[],
): Promise<{ [address: string]: number }> {
  const chainInfo = getChainInfo(tokens[0].chainId);
  if (chainInfo.coingecko_asset_platform_id === undefined) return {};
  const addresses = tokens.map((token) => token.address).toString();
  const priceResponse = await axios.get(
    `https://api.coingecko.com/api/v3/simple/token_price/${chainInfo.coingecko_asset_platform_id}?contract_addresses=${addresses}&vs_currencies=usd`,
  );
  // Coingecko call example: https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&vs_currencies=usd
  return Object.keys(priceResponse.data).reduce(
    (obj: { [address: string]: number }, address: string) => {
      obj[address] = priceResponse.data[address]['usd'];
      return obj;
    },
    {},
  );
}

/**
 * For a given tick range from `tickLower` to `tickUpper`, and a given proportion of the position value that is held in
 * token0, calculate the raw price of token0 denominated in token1.
 * @param tickLower The lower tick of the range.
 * @param tickUpper The upper tick of the range.
 * @param token0ValueProportion The proportion of the position value that is held in token0, as a `Big` number between 0
 * and 1, inclusive.
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
  const L = new Big(sqrtRatioAtTickLowerX96.toString()).div(Q96);
  const U = new Big(sqrtRatioAtTickUpperX96.toString()).div(Q96);
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

/**
 * Given a price ratio of token1/token0, calculate the proportion of the position value that is held in token0 for a
 * given tick range. Inverse of `getRawRelativePriceFromTokenValueProportion`.
 * @param tickLower The lower tick of the range.
 * @param tickUpper The upper tick of the range.
 * @param priceRatio The price ratio of token1/token0, as a `Big` number.
 * @returns The proportion of the position value that is held in token0, as a `Big` number between 0 and 1, inclusive.
 */
export function getTokenValueProportionFromPriceRatio(
  tickLower: number,
  tickUpper: number,
  priceRatio: Big,
): Big {
  const sqrtPriceX96 = JSBI.BigInt(
    priceRatio.times(Q96).times(Q96).sqrt().toFixed(0).toString(),
  );
  const tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
  // only token0
  if (tick < tickLower) {
    return new Big(1);
  }
  // only token1
  else if (tick >= tickUpper) {
    return new Big(0);
  } else {
    const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
    const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
    const liquidity = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
    const amount0 = SqrtPriceMath.getAmount0Delta(
      sqrtPriceX96,
      sqrtRatioBX96,
      liquidity,
      false,
    );
    const amount1 = SqrtPriceMath.getAmount1Delta(
      sqrtRatioAX96,
      sqrtPriceX96,
      liquidity,
      false,
    );
    const value0 = new Big(amount0.toString()).mul(priceRatio);
    return value0.div(value0.add(amount1.toString()));
  }
}
