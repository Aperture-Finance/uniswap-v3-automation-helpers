import {
  BigintIsh,
  Currency,
  CurrencyAmount,
  Percent,
  Price,
  Token,
} from '@uniswap/sdk-core';
import {
  FeeAmount,
  IncreaseOptions,
  MintOptions,
  NonfungiblePositionManager,
  Position,
  RemoveLiquidityOptions,
  TICK_SPACINGS,
  tickToPrice,
} from '@uniswap/v3-sdk';
import { BigNumberish, UnsignedTransaction } from 'ethers';
import { Provider } from '@ethersproject/abstract-provider';
import { priceToClosestUsableTick } from './tick';
import { ChainInfo, getChainInfo } from './chain';
import { getNativeEther } from './currency';
import { getPoolFromBasicPositionInfo } from './pool';
import {
  BasicPositionInfo,
  getCollectableTokenAmounts,
  getUniswapSDKPosition,
} from './position';
import JSBI from 'jsbi';
import { INonfungiblePositionManager__factory } from '@aperture_finance/uniswap-v3-automation-sdk';
import { getBasicPositionInfo } from './position';

function getTxToNonfungiblePositionManager(
  chainInfo: ChainInfo,
  data: string,
  value?: BigNumberish,
) {
  return {
    to: chainInfo.uniswap_v3_nonfungible_position_manager,
    data,
    value,
  };
}

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
  chainId: number,
  provider: Provider,
): Promise<UnsignedTransaction> {
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
  const pool = await getPoolFromBasicPositionInfo(
    basicPositionInfo,
    chainId,
    provider,
  );
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
  return getTxToNonfungiblePositionManager(
    getChainInfo(chainId),
    calldata,
    value,
  );
}

/**
 * Generates an unsigned transaction that creates a position as specified.
 * @param position The position to create.
 * @param options Options.
 * @param chainId Chain id.
 * @returns The unsigned tx.
 */
export function getCreatePositionTx(
  position: Position,
  options: Omit<MintOptions, 'createPool'>,
  chainId: number,
): UnsignedTransaction {
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    position,
    {
      ...options,
      // TODO: This should be set to true iff `position.pool` has not been created or not been initialized.
      createPool: false,
    },
  );
  return getTxToNonfungiblePositionManager(
    getChainInfo(chainId),
    calldata,
    value,
  );
}

/**
 * Generates an unsigned transaction that adds liquidity to an existing position.
 * Note that if the position involves ETH and the user wishes to provide native ether instead of WETH, then
 * `increaseLiquidityOptions.useNative` should be set to `getNativeEther(chainId)`.
 * @param increaseLiquidityOptions Increase liquidity options.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @param position Uniswap SDK Position object for the specified position (optional); if undefined, one will be created.
 * @returns The unsigned tx.
 */
export async function getAddLiquidityTx(
  increaseLiquidityOptions: IncreaseOptions,
  chainId: number,
  provider: Provider,
  liquidityToAdd: BigintIsh,
  position?: Position,
): Promise<UnsignedTransaction> {
  if (position === undefined) {
    position = await getUniswapSDKPosition(
      chainId,
      increaseLiquidityOptions.tokenId.toString(),
      provider,
    );
  }
  // Same as `position` except that the liquidity field represents the amount of liquidity to add to the existing `position`.
  const incrementalPosition = new Position({
    pool: position.pool,
    liquidity: liquidityToAdd,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
  });
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    incrementalPosition,
    increaseLiquidityOptions,
  );
  return getTxToNonfungiblePositionManager(
    getChainInfo(chainId),
    calldata,
    value,
  );
}

function convertCollectableTokenAmountToExpectedCurrencyOwed(
  collectableTokenAmount: {
    token0Amount: CurrencyAmount<Token>;
    token1Amount: CurrencyAmount<Token>;
  },
  chainId: number,
  token0: Token,
  token1: Token,
  receiveNativeEtherIfApplicable?: boolean,
): {
  expectedCurrencyOwed0: CurrencyAmount<Currency>;
  expectedCurrencyOwed1: CurrencyAmount<Currency>;
} {
  let expectedCurrencyOwed0: CurrencyAmount<Currency> =
    collectableTokenAmount.token0Amount;
  let expectedCurrencyOwed1: CurrencyAmount<Currency> =
    collectableTokenAmount.token1Amount;
  const nativeEther = getNativeEther(chainId);
  const weth = nativeEther.wrapped;
  if (receiveNativeEtherIfApplicable) {
    if (weth.equals(token0)) {
      expectedCurrencyOwed0 = CurrencyAmount.fromRawAmount(
        nativeEther,
        collectableTokenAmount.token0Amount.quotient,
      );
    } else if (weth.equals(token1)) {
      expectedCurrencyOwed1 = CurrencyAmount.fromRawAmount(
        nativeEther,
        collectableTokenAmount.token1Amount.quotient,
      );
    }
  }
  return {
    expectedCurrencyOwed0,
    expectedCurrencyOwed1,
  };
}

/**
 * Generates an unsigned transaction that removes partial or entire liquidity from the specified position and claim accrued fees.
 * @param removeLiquidityOptions Remove liquidity options.
 * @param recipient The recipient address (connected wallet address).
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @param receiveNativeEtherIfApplicable If set to true and the position involves ETH, send native ether instead of WETH to `recipient`.
 * @param position Uniswap SDK Position object for the specified position (optional); if undefined, one will be created.
 * @returns The unsigned tx.
 */
export async function getRemoveLiquidityTx(
  removeLiquidityOptions: Omit<RemoveLiquidityOptions, 'collectOptions'>,
  recipient: string,
  chainId: number,
  provider: Provider,
  receiveNativeEtherIfApplicable?: boolean,
  position?: Position,
): Promise<UnsignedTransaction> {
  if (position === undefined) {
    position = await getUniswapSDKPosition(
      chainId,
      removeLiquidityOptions.tokenId.toString(),
      provider,
    );
  }
  const collectableTokenAmount = await getCollectableTokenAmounts(
    chainId,
    removeLiquidityOptions.tokenId.toString(),
    provider,
    {
      token0: position.amount0.currency,
      token1: position.amount1.currency,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      fee: position.pool.fee,
    },
  );
  const { calldata, value } = NonfungiblePositionManager.removeCallParameters(
    position,
    {
      ...removeLiquidityOptions,
      collectOptions: {
        recipient,
        ...convertCollectableTokenAmountToExpectedCurrencyOwed(
          collectableTokenAmount,
          chainId,
          position.amount0.currency,
          position.amount1.currency,
          receiveNativeEtherIfApplicable,
        ),
      },
    },
  );
  return getTxToNonfungiblePositionManager(
    getChainInfo(chainId),
    calldata,
    value,
  );
}

/**
 * Generates an unsigned transaction that collects tokens from the specified position.
 * @param positionId Position id.
 * @param recipient The recipient address (connected wallet address).
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @param receiveNativeEtherIfApplicable If set to true and the position involves ETH, send native ether instead of WETH to `recipient`.
 * @param basicPositionInfo Basic position info (optional); if undefined, one will be created.
 * @returns The unsigned tx.
 */
export async function getCollectTx(
  positionId: BigNumberish,
  recipient: string,
  chainId: number,
  provider: Provider,
  receiveNativeEtherIfApplicable?: boolean,
  basicPositionInfo?: BasicPositionInfo,
): Promise<UnsignedTransaction> {
  if (basicPositionInfo === undefined) {
    basicPositionInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      provider,
    );
  }
  const collectableTokenAmount = await getCollectableTokenAmounts(
    chainId,
    positionId.toString(),
    provider,
    {
      token0: basicPositionInfo.token0,
      token1: basicPositionInfo.token1,
      tickLower: basicPositionInfo.tickLower,
      tickUpper: basicPositionInfo.tickUpper,
      fee: basicPositionInfo.fee,
    },
  );
  const { calldata, value } = NonfungiblePositionManager.collectCallParameters({
    tokenId: positionId.toString(),
    recipient,
    ...convertCollectableTokenAmountToExpectedCurrencyOwed(
      collectableTokenAmount,
      chainId,
      basicPositionInfo.token0,
      basicPositionInfo.token1,
      receiveNativeEtherIfApplicable,
    ),
  });
  return getTxToNonfungiblePositionManager(
    getChainInfo(chainId),
    calldata,
    value,
  );
}

/**
 * Set or revoke Aperture UniV3 Automan contract as an operator of the signer's UniV3 positions.
 * @param chainId Chain id.
 * @param approved True if setting approval, false if revoking approval.
 * @returns The unsigned tx setting or revoking approval.
 */
export function getSetApprovalForAllTx(
  chainId: number,
  approved: boolean,
): UnsignedTransaction {
  const chainInfo = getChainInfo(chainId);
  return getTxToNonfungiblePositionManager(
    chainInfo,
    INonfungiblePositionManager__factory.createInterface().encodeFunctionData(
      'setApprovalForAll',
      [chainInfo.aperture_uniswap_v3_automan, approved],
    ),
  );
}
