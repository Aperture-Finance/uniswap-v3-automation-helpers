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
  Position,
  RemoveLiquidityOptions,
  TICK_SPACINGS,
  tickToPrice,
} from '@uniswap/v3-sdk';
import { BigNumber, BigNumberish } from 'ethers';
import { Provider } from '@ethersproject/abstract-provider';
import {
  TransactionReceipt,
  TransactionRequest,
} from '@ethersproject/providers';
import { priceToClosestUsableTick } from './tick';
import { ApertureSupportedChainId, ChainInfo, getChainInfo } from './chain';
import { getNativeCurrency } from './currency';
import { getPoolFromBasicPositionInfo } from './pool';
import {
  BasicPositionInfo,
  getCollectableTokenAmounts,
  getPosition,
} from './position';
import JSBI from 'jsbi';
import {
  INonfungiblePositionManager,
  INonfungiblePositionManager__factory,
  IUniV3Automan__factory,
  IUniswapV3Factory__factory,
  IUniswapV3Pool__factory,
  PermitInfo,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { getBasicPositionInfo } from './position';
import {
  AutomanFragment,
  AutomanParams,
  getAutomanRebalanceCallInfo,
  getAutomanReinvestCallInfo,
} from './automan';

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
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<TransactionRequest> {
  if (
    inputCurrencyAmount.currency.isNative &&
    !getNativeCurrency(chainId).wrapped.equals(outerLimitPrice.baseCurrency)
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
 * @returns The unsigned tx.
 */
export async function getCreatePositionTx(
  position: Position,
  options: Omit<MintOptions, 'createPool'>,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<TransactionRequest> {
  const chainInfo = getChainInfo(chainId);
  const poolAddress = await IUniswapV3Factory__factory.connect(
    chainInfo.uniswap_v3_factory,
    provider,
  ).getPool(
    position.pool.token0.address,
    position.pool.token1.address,
    position.pool.fee,
  );
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    position,
    {
      ...options,
      createPool:
        poolAddress == ADDRESS_ZERO ||
        (
          await IUniswapV3Pool__factory.connect(poolAddress, provider).slot0()
        ).sqrtPriceX96.isZero(),
    },
  );
  return getTxToNonfungiblePositionManager(chainInfo, calldata, value);
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
  chainId: ApertureSupportedChainId,
  provider: Provider,
  liquidityToAdd: BigintIsh,
  position?: Position,
): Promise<TransactionRequest> {
  if (position === undefined) {
    position = await getPosition(
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
  const nativeEther = getNativeCurrency(chainId);
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
  chainId: ApertureSupportedChainId,
  provider: Provider,
  receiveNativeEtherIfApplicable?: boolean,
  position?: Position,
): Promise<TransactionRequest> {
  if (position === undefined) {
    position = await getPosition(
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

async function getAmountMinFromSlippage(
  automanAddress: string,
  ownerAddress: string,
  functionFragment: AutomanFragment,
  functionParams: AutomanParams,
  slippageTolerance: Percent,
  provider: Provider,
): Promise<{
  amount0Min: BigNumberish;
  amount1Min: BigNumberish;
}> {
  const { amount0, amount1 } = (await IUniV3Automan__factory.connect(
    automanAddress,
    provider,
    // @ts-ignore
  ).callStatic[functionFragment](...functionParams, {
    from: ownerAddress,
  })) as {
    amount0: BigNumber;
    amount1: BigNumber;
  };
  const coefficient = new Percent(1).subtract(slippageTolerance);
  return {
    amount0Min: coefficient.multiply(amount0.toString()).quotient.toString(),
    amount1Min: coefficient.multiply(amount1.toString()).quotient.toString(),
  };
}

export async function getRebalanceTx(
  chainId: ApertureSupportedChainId,
  ownerAddress: string,
  existingPositionId: BigNumberish,
  newPosition: Position,
  // How much the amount of either token0 or token1 in the new position is allowed to change unfavorably.
  slippageTolerance: Percent,
  deadlineEpochSeconds: BigNumberish,
  provider: Provider,
  permitInfo?: PermitInfo,
): Promise<TransactionRequest> {
  let mintParams: INonfungiblePositionManager.MintParamsStruct = {
    token0: newPosition.amount0.currency.address,
    token1: newPosition.amount1.currency.address,
    fee: newPosition.pool.fee,
    tickLower: newPosition.tickLower,
    tickUpper: newPosition.tickLower,
    amount0Desired: 0, // Param value ignored by Automan.
    amount1Desired: 0, // Param value ignored by Automan.
    amount0Min: 0, // Setting this to zero for tx simulation.
    amount1Min: 0, // Setting this to zero for tx simulation.
    recipient: ADDRESS_ZERO, // Param value ignored by Automan.
    deadline: deadlineEpochSeconds,
  };
  const automanAddress = getChainInfo(chainId).aperture_uniswap_v3_automan;
  const { functionFragment, params } = getAutomanRebalanceCallInfo(
    mintParams,
    existingPositionId,
    permitInfo,
  );
  const amountMin = await getAmountMinFromSlippage(
    automanAddress,
    ownerAddress,
    functionFragment,
    params,
    slippageTolerance,
    provider,
  );
  mintParams.amount0Min = amountMin.amount0Min;
  mintParams.amount1Min = amountMin.amount1Min;
  return {
    from: ownerAddress,
    to: automanAddress,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      // @ts-ignore
      functionFragment,
      getAutomanRebalanceCallInfo(mintParams, existingPositionId, permitInfo)
        .params,
    ),
  };
}

export async function getReinvestTx(
  chainId: ApertureSupportedChainId,
  ownerAddress: string,
  positionId: BigNumberish,
  // How much the reinvested amount of either token0 or token1 is allowed to change unfavorably.
  slippageTolerance: Percent,
  deadlineEpochSeconds: BigNumberish,
  provider: Provider,
  permitInfo?: PermitInfo,
): Promise<TransactionRequest> {
  let increaseLiquidityParams: INonfungiblePositionManager.IncreaseLiquidityParamsStruct =
    {
      tokenId: positionId,
      amount0Desired: 0, // Param value ignored by Automan.
      amount1Desired: 0, // Param value ignored by Automan.
      amount0Min: 0, // Setting this to zero for tx simulation.
      amount1Min: 0, // Setting this to zero for tx simulation.
      deadline: deadlineEpochSeconds,
    };
  const automanAddress = getChainInfo(chainId).aperture_uniswap_v3_automan;
  const { functionFragment, params } = getAutomanReinvestCallInfo(
    increaseLiquidityParams,
    permitInfo,
  );
  const amountMin = await getAmountMinFromSlippage(
    automanAddress,
    ownerAddress,
    functionFragment,
    params,
    slippageTolerance,
    provider,
  );
  increaseLiquidityParams.amount0Min = amountMin.amount0Min;
  increaseLiquidityParams.amount1Min = amountMin.amount1Min;
  return {
    from: ownerAddress,
    to: automanAddress,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      // @ts-ignore
      functionFragment,
      getAutomanReinvestCallInfo(increaseLiquidityParams, permitInfo).params,
    ),
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
 * Parses the specified transaction receipt and extracts the position id (token id) minted by NPM within the transaction.
 * @param txReceipt The transaction receipt to parse.
 * @param recipientAddress The receipt address to which the position is minted.
 * @param chainId The chain id.
 * @returns If a position is minted to `recipientAddress`, the position id is returned. If there is more than one, the first is returned. If there are none, `undefined` is returned.
 */
export function getMintedPositionIdFromTxReceipt(
  txReceipt: TransactionReceipt,
  recipientAddress: string,
  chainId: ApertureSupportedChainId,
): BigNumber | undefined {
  const npmInterface = INonfungiblePositionManager__factory.createInterface();
  const npmAddress =
    getChainInfo(chainId).uniswap_v3_nonfungible_position_manager;
  for (const log of txReceipt.logs) {
    if (npmAddress === log.address) {
      const parsedLog = npmInterface.parseLog(log);
      if (
        parsedLog.name === 'Transfer' &&
        parsedLog.args.from === ADDRESS_ZERO &&
        parsedLog.args.to === recipientAddress
      ) {
        return parsedLog.args.tokenId;
      }
    }
  }
  return undefined;
}
