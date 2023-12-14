import {
  ApertureSupportedChainId,
  ChainInfo,
  INonfungiblePositionManager,
  INonfungiblePositionManager__factory,
  IUniV3Automan__factory,
  PermitInfo,
  WETH__factory,
  getChainInfo,
  priceToClosestTickSafe,
  tickToLimitOrderRange,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { EventFragment } from '@ethersproject/abi';
import {
  JsonRpcProvider,
  Log,
  Provider,
  TransactionReceipt,
  TransactionRequest,
} from '@ethersproject/providers';
import {
  BigintIsh,
  Currency,
  CurrencyAmount,
  Percent,
  Price,
  Token,
} from '@uniswap/sdk-core';
import {
  ADDRESS_ZERO,
  FeeAmount,
  IncreaseOptions,
  MintOptions,
  NonfungiblePositionManager,
  Pool,
  Position,
  RemoveLiquidityOptions,
} from '@uniswap/v3-sdk';
import { BigNumber, BigNumberish } from 'ethers';
import JSBI from 'jsbi';

import { optimalMint } from './aggregator';
import {
  AutomanFragment,
  getAutomanRebalanceCallInfo,
  getAutomanReinvestCallInfo,
  simulateRemoveLiquidity,
} from './automan';
import { getNativeCurrency } from './currency';
import { getPool } from './pool';
import {
  BasicPositionInfo,
  CollectableTokenAmounts,
  PositionDetails,
  getBasicPositionInfo,
  viewCollectableTokenAmounts,
} from './position';

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
 * @param outerLimitPrice The outer limit price where the base currency is the input asset (what the user wants to sell)
 * and the quote currency is the output asset (what the user wants to buy).
 * @param inputCurrencyAmount The amount of input asset that the user wants to sell.
 * @param poolFee The fee tier of the liquidity pool that the limit order position should be created on.
 * @param deadlineEpochSeconds Transaction deadline in seconds since UNIX epoch.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @param widthMultiplier The width multiplier of the tick range in terms of tick spacing.
 * @returns The unsigned transaction that creates such a position.
 */
export async function getCreatePositionTxForLimitOrder(
  recipient: string,
  outerLimitPrice: Price<Token, Token>,
  inputCurrencyAmount: CurrencyAmount<Currency>,
  poolFee: FeeAmount,
  deadlineEpochSeconds: BigNumberish,
  chainId: ApertureSupportedChainId,
  provider: Provider,
  widthMultiplier = 1,
): Promise<TransactionRequest> {
  if (
    inputCurrencyAmount.currency.isNative &&
    !getNativeCurrency(chainId).wrapped.equals(outerLimitPrice.baseCurrency)
  ) {
    throw 'Input currency is native ether but base currency is not WETH';
  }
  const { tickLower, tickUpper } = tickToLimitOrderRange(
    priceToClosestTickSafe(outerLimitPrice),
    poolFee,
    widthMultiplier,
  );
  const zeroToOne = outerLimitPrice.baseCurrency.sortsBefore(
    outerLimitPrice.quoteCurrency,
  );
  const pool = await getPool(
    outerLimitPrice.baseCurrency,
    outerLimitPrice.quoteCurrency,
    poolFee,
    chainId,
    provider,
  );
  const position = zeroToOne
    ? Position.fromAmount0({
        pool,
        tickLower,
        tickUpper,
        amount0: inputCurrencyAmount.quotient,
        useFullPrecision: false,
      })
    : Position.fromAmount1({
        pool,
        tickLower,
        tickUpper,
        amount1: inputCurrencyAmount.quotient,
      });
  const { amount0, amount1 } = position.mintAmounts;
  if (
    (zeroToOne && JSBI.greaterThan(amount1, JSBI.BigInt(0))) ||
    (!zeroToOne && JSBI.greaterThan(amount0, JSBI.BigInt(0)))
  ) {
    throw 'Specified limit price not applicable';
  }
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    position,
    {
      slippageTolerance: new Percent(0),
      deadline: deadlineEpochSeconds.toString(),
      useNative: inputCurrencyAmount.currency.isNative
        ? getNativeCurrency(chainId)
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
 * @param provider Ethers provider.
 * @returns The unsigned tx.
 */
export async function getCreatePositionTx(
  position: Position,
  options: Omit<MintOptions, 'createPool'>,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<TransactionRequest> {
  let createPool = false;
  try {
    await getPool(
      position.pool.token0,
      position.pool.token1,
      position.pool.fee,
      chainId,
      provider,
    );
  } catch (e) {
    createPool = true;
  }
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    position,
    {
      ...options,
      createPool,
    },
  );
  return getTxToNonfungiblePositionManager(
    getChainInfo(chainId),
    calldata,
    value,
  );
}

/**
 * Generates an unsigned transaction that mints the optimal amount of liquidity for the specified token amounts and price range.
 * @param chainId The chain ID.
 * @param token0Amount The token0 amount.
 * @param token1Amount The token1 amount.
 * @param fee The pool fee tier.
 * @param tickLower The lower tick of the range.
 * @param tickUpper The upper tick of the range.
 * @param recipient The recipient address.
 * @param deadline The deadline in seconds before which the transaction must be mined.
 * @param slippage The slippage tolerance.
 * @param provider A JSON RPC provider or a base provider.
 */
export async function getOptimalMintTx(
  chainId: ApertureSupportedChainId,
  token0Amount: CurrencyAmount<Currency>,
  token1Amount: CurrencyAmount<Currency>,
  fee: FeeAmount,
  tickLower: number,
  tickUpper: number,
  recipient: string,
  deadline: BigNumberish,
  slippage: number,
  provider: JsonRpcProvider | Provider,
) {
  let value: BigNumberish | undefined;
  if (token0Amount.currency.isNative) {
    token0Amount = CurrencyAmount.fromRawAmount(
      getNativeCurrency(chainId).wrapped,
      token0Amount.quotient,
    );
    value = token0Amount.quotient.toString();
  } else if (token1Amount.currency.isNative) {
    token1Amount = CurrencyAmount.fromRawAmount(
      getNativeCurrency(chainId).wrapped,
      token1Amount.quotient,
    );
    value = token1Amount.quotient.toString();
  }
  const { liquidity, swapData } = await optimalMint(
    chainId,
    token0Amount as CurrencyAmount<Token>,
    token1Amount as CurrencyAmount<Token>,
    fee,
    tickLower,
    tickUpper,
    recipient,
    slippage,
    provider,
  );
  const token0 = (token0Amount.currency as Token).address;
  const token1 = (token1Amount.currency as Token).address;
  const position = new Position({
    pool: await getPool(token0, token1, fee, chainId, provider),
    liquidity: liquidity.toString(),
    tickLower,
    tickUpper,
  });
  const { amount0, amount1 } = position.mintAmountsWithSlippage(
    new Percent(Math.floor(slippage * 1e6), 1e6),
  );
  const mintParams = {
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    amount0Desired: token0Amount.quotient.toString(),
    amount1Desired: token1Amount.quotient.toString(),
    amount0Min: amount0.toString(),
    amount1Min: amount1.toString(),
    recipient,
    deadline,
  };
  const data = IUniV3Automan__factory.createInterface().encodeFunctionData(
    'mintOptimal',
    [mintParams, swapData],
  );
  return {
    to: getChainInfo(chainId).aperture_uniswap_v3_automan,
    data,
    value,
  };
}

/**
 * Generates an unsigned transaction that adds liquidity to an existing position.
 * Note that if the position involves ETH and the user wishes to provide native ether instead of WETH, then
 * `increaseLiquidityOptions.useNative` should be set to `getNativeEther(chainId)`.
 * @param increaseLiquidityOptions Increase liquidity options.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @param liquidityToAdd The amount of liquidity to add to the existing position.
 * @param position Uniswap SDK Position object for the specified position (optional); if undefined, one will be created.
 * @returns The unsigned tx.
 */
export async function getAddLiquidityTx(
  increaseLiquidityOptions: IncreaseOptions,
  chainId: ApertureSupportedChainId,
  provider: Provider,
  liquidityToAdd: BigintIsh,
  position?: Position,
): Promise<TransactionRequest> {
  if (position === undefined) {
    ({ position } = await PositionDetails.fromPositionId(
      chainId,
      increaseLiquidityOptions.tokenId.toString(),
      provider,
    ));
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
  chainId: ApertureSupportedChainId,
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
  if (receiveNativeEtherIfApplicable) {
    const nativeEther = getNativeCurrency(chainId);
    const weth = nativeEther.wrapped;
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
  chainId: ApertureSupportedChainId,
  provider: Provider,
  receiveNativeEtherIfApplicable?: boolean,
  position?: Position,
): Promise<TransactionRequest> {
  if (position === undefined) {
    ({ position } = await PositionDetails.fromPositionId(
      chainId,
      removeLiquidityOptions.tokenId.toString(),
      provider,
    ));
  }
  const collectableTokenAmount = await viewCollectableTokenAmounts(
    chainId,
    removeLiquidityOptions.tokenId.toString(),
    provider,
    {
      token0: position.pool.token0,
      token1: position.pool.token1,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      fee: position.pool.fee,
    },
  );
  const { calldata, value } = NonfungiblePositionManager.removeCallParameters(
    position,
    {
      ...removeLiquidityOptions,
      // Note that the `collect()` function of the NPM contract takes `CollectOptions` with
      // `expectedCurrencyOwed0` and `expectedCurrencyOwed1` that should include both the
      // decreased principal liquidity and the accrued fees.
      // However, here we only pass the accrued fees in `collectOptions` because the principal
      // liquidity is added to what is passed here by `NonfungiblePositionManager.removeCallParameters()`
      // when constructing the `collect()` call.
      collectOptions: {
        recipient,
        ...convertCollectableTokenAmountToExpectedCurrencyOwed(
          collectableTokenAmount,
          chainId,
          position.pool.token0,
          position.pool.token1,
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

export async function getRemoveLiquiditySingleTx() {}

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
  chainId: ApertureSupportedChainId,
  provider: Provider,
  receiveNativeEtherIfApplicable?: boolean,
  basicPositionInfo?: BasicPositionInfo,
): Promise<TransactionRequest> {
  if (basicPositionInfo === undefined) {
    basicPositionInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      provider,
    );
  }
  const collectableTokenAmount = await viewCollectableTokenAmounts(
    chainId,
    positionId.toString(),
    provider,
    basicPositionInfo,
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

interface SimulatedAmounts {
  amount0: BigNumber;
  amount1: BigNumber;
  amount0Min: BigNumberish;
  amount1Min: BigNumberish;
}

async function getAmountsWithSlippage(
  pool: Pool,
  tickLower: number,
  tickUpper: number,
  automanAddress: string,
  ownerAddress: string,
  functionFragment: AutomanFragment,
  data: string,
  slippageTolerance: Percent,
  provider: Provider,
): Promise<SimulatedAmounts> {
  const returnData = await provider.call({
    from: ownerAddress,
    to: automanAddress,
    data,
  });
  const { amount0, amount1, liquidity } =
    IUniV3Automan__factory.createInterface().decodeFunctionResult(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      functionFragment,
      returnData,
    ) as unknown as {
      amount0: BigNumber;
      amount1: BigNumber;
      liquidity: BigNumber;
    };
  const { amount0: amount0Min, amount1: amount1Min } = new Position({
    pool,
    liquidity: liquidity.toString(),
    tickLower,
    tickUpper,
  }).mintAmountsWithSlippage(slippageTolerance);
  return {
    amount0,
    amount1,
    amount0Min: amount0Min.toString(),
    amount1Min: amount1Min.toString(),
  };
}

/**
 * Generates an unsigned transaction that rebalances an existing position into a new one with the specified price range using Aperture's Automan contract.
 * @param chainId Chain id.
 * @param ownerAddress Owner of the existing position.
 * @param existingPositionId Existing position token id.
 * @param newPositionTickLower The lower tick of the new position.
 * @param newPositionTickUpper The upper tick of the new position.
 * @param slippageTolerance How much the amount of either token0 or token1 in the new position is allowed to change unfavorably.
 * @param deadlineEpochSeconds Timestamp when the tx expires (in seconds since epoch).
 * @param provider Ethers provider.
 * @param position Optional, the existing position.
 * @param permitInfo Optional. If Automan doesn't already have authority over the existing position, this should be populated with valid owner-signed permit info.
 * @param use1inch Optional. If set to true, the 1inch aggregator will be used to facilitate the swap.
 * @returns The generated transaction request and expected amounts.
 */
export async function getRebalanceTx(
  chainId: ApertureSupportedChainId,
  ownerAddress: string,
  existingPositionId: BigNumberish,
  newPositionTickLower: number,
  newPositionTickUpper: number,
  slippageTolerance: Percent,
  deadlineEpochSeconds: BigNumberish,
  provider: JsonRpcProvider | Provider,
  position?: Position,
  permitInfo?: PermitInfo,
  use1inch?: boolean,
): Promise<{
  tx: TransactionRequest;
  amounts: SimulatedAmounts;
}> {
  if (position === undefined) {
    ({ position } = await PositionDetails.fromPositionId(
      chainId,
      existingPositionId,
      provider,
    ));
  }
  let swapData = '0x';
  if (use1inch) {
    try {
      const { amount0: receive0, amount1: receive1 } =
        await simulateRemoveLiquidity(
          chainId,
          provider,
          ownerAddress,
          ownerAddress,
          existingPositionId,
          0,
          0,
          0,
        );
      ({ swapData } = await optimalMint(
        chainId,
        CurrencyAmount.fromRawAmount(position.pool.token0, receive0.toString()),
        CurrencyAmount.fromRawAmount(position.pool.token1, receive1.toString()),
        position.pool.fee,
        newPositionTickLower,
        newPositionTickUpper,
        ownerAddress,
        Number(slippageTolerance.numerator.toString()) /
          Number(slippageTolerance.denominator.toString()),
        provider,
      ));
    } catch (err) {
      console.error(
        `Failed to construct 1inch swap data: ${err}. Will proceed with same-pool swap.`,
      );
    }
  }
  const mintParams: INonfungiblePositionManager.MintParamsStruct = {
    token0: position.pool.token0.address,
    token1: position.pool.token1.address,
    fee: position.pool.fee,
    tickLower: newPositionTickLower,
    tickUpper: newPositionTickUpper,
    amount0Desired: 0, // Param value ignored by Automan.
    amount1Desired: 0, // Param value ignored by Automan.
    amount0Min: 0, // Setting this to zero for tx simulation.
    amount1Min: 0, // Setting this to zero for tx simulation.
    recipient: ADDRESS_ZERO, // Param value ignored by Automan.
    deadline: deadlineEpochSeconds,
  };
  const { aperture_uniswap_v3_automan } = getChainInfo(chainId);
  const { functionFragment, data } = getAutomanRebalanceCallInfo(
    mintParams,
    existingPositionId,
    0,
    permitInfo,
    swapData,
  );
  const amounts = await getAmountsWithSlippage(
    position.pool,
    newPositionTickLower,
    newPositionTickUpper,
    aperture_uniswap_v3_automan,
    ownerAddress,
    functionFragment,
    data,
    slippageTolerance,
    provider,
  );
  mintParams.amount0Min = amounts.amount0Min;
  mintParams.amount1Min = amounts.amount1Min;
  return {
    tx: {
      from: ownerAddress,
      to: aperture_uniswap_v3_automan,
      data: getAutomanRebalanceCallInfo(
        mintParams,
        existingPositionId,
        0,
        permitInfo,
        swapData,
      ).data,
    },
    amounts,
  };
}

/**
 * Generates an unsigned tx that collects fees and reinvests into the specified position.
 * @param chainId Chain id.
 * @param ownerAddress Owner of the specified position.
 * @param positionId Position id.
 * @param slippageTolerance How much the reinvested amount of either token0 or token1 is allowed to change unfavorably.
 * @param deadlineEpochSeconds Timestamp when the tx expires (in seconds since epoch).
 * @param provider Ethers provider.
 * @param permitInfo Optional. If Automan doesn't already have authority over the existing position, this should be populated with a valid owner-signed permit info.
 * @returns The generated transaction request and expected amounts.
 */
export async function getReinvestTx(
  chainId: ApertureSupportedChainId,
  ownerAddress: string,
  positionId: BigNumberish,
  slippageTolerance: Percent,
  deadlineEpochSeconds: BigNumberish,
  provider: Provider,
  permitInfo?: PermitInfo,
): Promise<{
  tx: TransactionRequest;
  amounts: SimulatedAmounts;
}> {
  const { pool, tickLower, tickUpper } = await PositionDetails.fromPositionId(
    chainId,
    positionId,
    provider,
  );
  const { aperture_uniswap_v3_automan } = getChainInfo(chainId);
  const { functionFragment, data } = getAutomanReinvestCallInfo(
    positionId,
    deadlineEpochSeconds,
    0, // Setting this to zero for tx simulation.
    0, // Setting this to zero for tx simulation.
    0,
    permitInfo,
  );
  const amounts = await getAmountsWithSlippage(
    pool,
    tickLower,
    tickUpper,
    aperture_uniswap_v3_automan,
    ownerAddress,
    functionFragment,
    data,
    slippageTolerance,
    provider,
  );
  return {
    tx: {
      from: ownerAddress,
      to: aperture_uniswap_v3_automan,
      data: getAutomanReinvestCallInfo(
        positionId,
        deadlineEpochSeconds,
        amounts.amount0Min,
        amounts.amount1Min,
        0,
        permitInfo,
      ).data,
    },
    amounts,
  };
}

export function getWrapETHTx(
  chainId: ApertureSupportedChainId,
  amount: BigNumberish,
): TransactionRequest {
  if (chainId === ApertureSupportedChainId.CELO_MAINNET_CHAIN_ID) {
    throw new Error('CELO wrapping is not applicable');
  }
  return {
    to: getChainInfo(chainId).wrappedNativeCurrency.address,
    data: WETH__factory.createInterface().encodeFunctionData('deposit'),
    value: amount,
  };
}

export function getUnwrapETHTx(
  chainId: ApertureSupportedChainId,
  amount: BigNumberish,
): TransactionRequest {
  if (chainId === ApertureSupportedChainId.CELO_MAINNET_CHAIN_ID) {
    throw new Error('CELO unwrapping is not applicable');
  }
  return {
    to: getChainInfo(chainId).wrappedNativeCurrency.address,
    data: WETH__factory.createInterface().encodeFunctionData('withdraw', [
      amount,
    ]),
  };
}

/**
 * Set or revoke Aperture UniV3 Automan contract as an operator of the signer's UniV3 positions.
 * @param chainId Chain id.
 * @param approved True if setting approval, false if revoking approval.
 * @returns The unsigned tx setting or revoking approval.
 */
export function getSetApprovalForAllTx(
  chainId: ApertureSupportedChainId,
  approved: boolean,
): TransactionRequest {
  const chainInfo = getChainInfo(chainId);
  return getTxToNonfungiblePositionManager(
    chainInfo,
    INonfungiblePositionManager__factory.createInterface().encodeFunctionData(
      'setApprovalForAll',
      [chainInfo.aperture_uniswap_v3_automan, approved],
    ),
  );
}

/**
 * Filter logs by event.
 * @param receipt Transaction receipt.
 * @param event Event fragment.
 * @returns The filtered logs.
 */
export function filterLogsByEvent(
  receipt: TransactionReceipt,
  event: EventFragment,
): Log[] {
  const eventSig =
    INonfungiblePositionManager__factory.createInterface().getEventTopic(event);
  return receipt.logs.filter((log) => log.topics[0] === eventSig);
}

/**
 * Parses the specified transaction receipt and extracts the position id (token id) minted by NPM within the transaction.
 * @param chainId Chain id.
 * @param txReceipt The transaction receipt to parse.
 * @param recipientAddress The receipt address to which the position is minted.
 * @returns If a position is minted to `recipientAddress`, the position id is returned. If there is more than one, the first is returned. If there are none, `undefined` is returned.
 */
export function getMintedPositionIdFromTxReceipt(
  chainId: ApertureSupportedChainId,
  txReceipt: TransactionReceipt,
  recipientAddress: string,
): BigNumber | undefined {
  const npmAddress =
    getChainInfo(chainId).uniswap_v3_nonfungible_position_manager.toLowerCase();
  const npmInterface = INonfungiblePositionManager__factory.createInterface();
  const transferLogs = filterLogsByEvent(
    txReceipt,
    npmInterface.getEvent('Transfer'),
  );
  recipientAddress = recipientAddress.toLowerCase();
  for (const log of transferLogs) {
    if (log.address.toLowerCase() === npmAddress) {
      try {
        const event = npmInterface.parseLog(log);
        if (event.args.to.toLowerCase() === recipientAddress) {
          return event.args.tokenId;
        }
      } catch (e) {}
    }
  }
  return undefined;
}

/**
 * Get the collected fees in the position from a transaction receipt.
 * @param receipt Transaction receipt.
 * @param token0 Token 0.
 * @param token1 Token 1.
 * @returns A promise that resolves to the collected amount of the two tokens in the position.
 */
export function getCollectedFeesFromReceipt(
  receipt: TransactionReceipt,
  token0: Token,
  token1: Token,
): CollectableTokenAmounts {
  const npmInterface = INonfungiblePositionManager__factory.createInterface();
  const collectLog = filterLogsByEvent(
    receipt,
    npmInterface.getEvent('Collect'),
  );
  let total0: BigNumber, total1: BigNumber;
  try {
    const collectEvent = npmInterface.parseLog(collectLog[0]);
    total0 = collectEvent.args.amount0;
    total1 = collectEvent.args.amount1;
  } catch (e) {
    throw new Error('Failed to decode collect event');
  }
  const decreaseLiquidityLog = filterLogsByEvent(
    receipt,
    npmInterface.getEvent('DecreaseLiquidity'),
  );
  let principal0 = BigNumber.from(0);
  let principal1 = BigNumber.from(0);
  if (decreaseLiquidityLog.length > 0) {
    try {
      const decreaseLiquidityEvent = npmInterface.parseLog(
        decreaseLiquidityLog[0],
      );
      principal0 = decreaseLiquidityEvent.args.amount0;
      principal1 = decreaseLiquidityEvent.args.amount1;
    } catch (e) {
      throw new Error('Failed to decode decrease liquidity event');
    }
  }
  return {
    token0Amount: CurrencyAmount.fromRawAmount(
      token0,
      total0.sub(principal0).toString(),
    ),
    token1Amount: CurrencyAmount.fromRawAmount(
      token1,
      total1.sub(principal1).toString(),
    ),
  };
}
