import {
  Currency,
  CurrencyAmount,
  Ether,
  NativeCurrency,
  Token,
} from '@uniswap/sdk-core';
import { Provider } from '@ethersproject/abstract-provider';
import { ERC20__factory } from '@aperture_finance/uniswap-v3-automation-sdk';
import { parseFixed } from '@ethersproject/bignumber';
import { ApertureSupportedChainId } from './chain';

// The `Currency` type is defined as `Currency = NativeCurrency | Token`.
// When a liquidity pool involves ETH, i.e. WETH is one of the two tokens in the pool, the
// user can choose to provide either native ether or WETH when adding liquidity, placing a
// limit order to sell ETH, etc.
// Similar to Uniswap frontend, our frontend should allow user to pick either native ETH or
// WETH. If the former, `getNativeEther()` should be used to represent native ether; in the
// latter case, `getToken()` with WETH's address should be invoked to represent the WETH
// token, similar to all other ERC-20 tokens.

export async function getToken(
  tokenAddress: string,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Token> {
  const decimals = await ERC20__factory.connect(
    tokenAddress,
    provider,
  ).decimals();
  return new Token(chainId, tokenAddress, decimals);
}

// TODO: `Ether` is only for Ethereum mainnet and all testnets. Arbitrum mainnet and testnet should use another NativeCurrency subclass.
export function getNativeEther(
  chainId: ApertureSupportedChainId,
): NativeCurrency {
  return Ether.onChain(chainId);
}

/**
 * Parses a human-readable currency amount and returns a CurrencyAmount instance internally
 * storing its raw amount. Note that `humanAmount` must be a valid decimal number with a
 * precision not exceeding the currency's 'decimals' value. For example, if a token has
 * 4 decimals, then "12.3456" and "12.3" are both valid `humanAmount` values, but "12.34567"
 * is not. If `humanAmount` is invalid, an error is thrown (by `parseFixed()`).
 * @param currency The currency.
 * @param humanAmount The human-readable amount.
 * @returns The constructed CurrencyAmount.
 */
export function getCurrencyAmount(
  currency: Currency,
  humanAmount: string,
): CurrencyAmount<Currency> {
  return CurrencyAmount.fromRawAmount(
    currency,
    parseFixed(humanAmount, currency.decimals).toString(),
  );
}
