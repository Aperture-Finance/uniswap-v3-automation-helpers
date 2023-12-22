import {
  ApertureSupportedChainId,
  INonfungiblePositionManager__factory,
  IUniV3Automan__factory,
  fractionToBig,
  getChainInfo,
  getTokenValueProportionFromPriceRatio,
  priceToSqrtRatioX96,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { BlockTag, JsonRpcProvider, Provider } from '@ethersproject/providers';
import { BigintIsh, CurrencyAmount, Token } from '@uniswap/sdk-core';
import {
  FeeAmount,
  Pool,
  Position,
  PositionLibrary,
  TickMath,
} from '@uniswap/v3-sdk';
import {
  EphemeralAllPositionsByOwner__factory,
  EphemeralGetPosition__factory,
} from 'aperture-lens';
import { PositionStateStructOutput } from 'aperture-lens/dist/typechain/contracts/EphemeralGetPosition';
import Big from 'big.js';
import { BigNumber, BigNumberish, Signer } from 'ethers';
import JSBI from 'jsbi';

import { getAutomanReinvestCallInfo } from './automan';
import { getToken } from './currency';
import { getNPMApprovalOverrides, staticCallWithOverrides } from './overrides';
import {
  getPool,
  getPoolContract,
  getPoolFromBasicPositionInfo,
  getPoolPrice,
} from './pool';

export interface BasicPositionInfo {
  token0: Token;
  token1: Token;
  fee: FeeAmount;
  liquidity?: BigintIsh;
  tickLower: number;
  tickUpper: number;
}

export interface CollectableTokenAmounts {
  token0Amount: CurrencyAmount<Token>;
  token1Amount: CurrencyAmount<Token>;
}

export function getNPM(
  chainId: ApertureSupportedChainId,
  provider: Provider | Signer,
) {
  return INonfungiblePositionManager__factory.connect(
    getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
    provider,
  );
}

export async function getBasicPositionInfo(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  provider: Provider,
  blockTag?: BlockTag,
): Promise<BasicPositionInfo> {
  const npm = getNPM(chainId, provider);
  const overrides = { blockTag };
  const positionInfo = await npm.positions(positionId, overrides);
  const [token0, token1] = await Promise.all([
    getToken(positionInfo.token0, chainId, provider, blockTag),
    getToken(positionInfo.token1, chainId, provider, blockTag),
  ]);
  return {
    token0,
    token1,
    fee: positionInfo.fee,
    tickLower: positionInfo.tickLower,
    tickUpper: positionInfo.tickUpper,
    liquidity: positionInfo.liquidity.toString(),
  };
}

export async function getPositionFromBasicInfo(
  basicInfo: BasicPositionInfo,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Position> {
  if (basicInfo.liquidity === undefined) {
    throw 'Missing position liquidity info';
  }
  return new Position({
    pool: await getPoolFromBasicPositionInfo(basicInfo, chainId, provider),
    liquidity: basicInfo.liquidity,
    tickLower: basicInfo.tickLower,
    tickUpper: basicInfo.tickUpper,
  });
}

/**
 * Get the Uniswap `Position` object for the specified position id.
 * @param chainId The chain ID.
 * @param positionId The position id.
 * @param provider The ethers provider.
 * @param blockTag Optional block tag to query.
 * @returns The `Position` object.
 */
export async function getPosition(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  provider: Provider,
  blockTag?: BlockTag,
) {
  const npm = getNPM(chainId, provider);
  const positionInfo = await npm.positions(positionId, { blockTag });
  const pool = await getPool(
    positionInfo.token0,
    positionInfo.token1,
    positionInfo.fee,
    chainId,
    provider,
    blockTag,
  );
  return new Position({
    pool,
    liquidity: positionInfo.liquidity.toString(),
    tickLower: positionInfo.tickLower,
    tickUpper: positionInfo.tickUpper,
  });
}

/**
 * Finds the amount of collectable tokens in the position.
 * The collectable amount is most likely accrued fees accumulated in the position, but can be from a prior decreaseLiquidity() call which has not been collected.
 * @param chainId Chain id.
 * @param positionId Position id.
 * @param provider Ethers provider.
 * @param basicPositionInfo Basic position info, optional; if undefined, one will be constructed.
 * @returns A promise that resolves to collectable amount of the two tokens in the position.
 */
export async function getCollectableTokenAmounts(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  provider: Provider,
  basicPositionInfo?: BasicPositionInfo,
): Promise<CollectableTokenAmounts> {
  if (basicPositionInfo === undefined) {
    basicPositionInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      provider,
    );
  }
  const npm = getNPM(chainId, provider);
  const owner = await npm.ownerOf(positionId);
  const MAX_UINT128 = BigNumber.from(2).pow(128).sub(1);
  const { amount0, amount1 } = await npm.callStatic.collect(
    {
      tokenId: positionId,
      recipient: owner,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    },
    {
      from: owner,
    },
  );
  return {
    token0Amount: CurrencyAmount.fromRawAmount(
      basicPositionInfo.token0,
      amount0.toString(),
    ),
    token1Amount: CurrencyAmount.fromRawAmount(
      basicPositionInfo.token1,
      amount1.toString(),
    ),
  };
}

/**
 * View the amount of collectable tokens in a position without specifying the owner as `from` which isn't multicallable.
 * The collectable amount is most likely accrued fees accumulated in the position, but can be from a prior decreaseLiquidity() call which has not been collected.
 * @param chainId Chain id.
 * @param positionId Position id.
 * @param provider Ethers provider.
 * @param basicPositionInfo Basic position info, optional.
 * @returns A promise that resolves to collectable amount of the two tokens in the position.
 */
export async function viewCollectableTokenAmounts(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  provider: Provider,
  basicPositionInfo?: BasicPositionInfo,
  blockTag?: BlockTag,
): Promise<CollectableTokenAmounts> {
  if (basicPositionInfo === undefined) {
    basicPositionInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      provider,
      blockTag,
    );
  }
  const pool = getPoolContract(
    basicPositionInfo.token0,
    basicPositionInfo.token1,
    basicPositionInfo.fee,
    chainId,
    provider,
  );
  const overrides = { blockTag };
  const [
    slot0,
    feeGrowthGlobal0X128,
    feeGrowthGlobal1X128,
    lower,
    upper,
    position,
  ] = await Promise.all([
    pool.slot0(overrides),
    pool.feeGrowthGlobal0X128(overrides),
    pool.feeGrowthGlobal1X128(overrides),
    pool.ticks(basicPositionInfo.tickLower, overrides),
    pool.ticks(basicPositionInfo.tickUpper),
    getNPM(chainId, provider).positions(positionId, overrides),
  ]);

  // https://github.com/Uniswap/v4-core/blob/f630c8ca8c669509d958353200953762fd15761a/contracts/libraries/Pool.sol#L566
  let feeGrowthInside0X128: BigNumber, feeGrowthInside1X128: BigNumber;
  if (slot0.tick < basicPositionInfo.tickLower) {
    feeGrowthInside0X128 = lower.feeGrowthOutside0X128.sub(
      upper.feeGrowthOutside0X128,
    );
    feeGrowthInside1X128 = lower.feeGrowthOutside1X128.sub(
      upper.feeGrowthOutside1X128,
    );
  } else if (slot0.tick >= basicPositionInfo.tickUpper) {
    feeGrowthInside0X128 = upper.feeGrowthOutside0X128.sub(
      lower.feeGrowthOutside0X128,
    );
    feeGrowthInside1X128 = upper.feeGrowthOutside1X128.sub(
      lower.feeGrowthOutside1X128,
    );
  } else {
    feeGrowthInside0X128 = feeGrowthGlobal0X128
      .sub(lower.feeGrowthOutside0X128)
      .sub(upper.feeGrowthOutside0X128);
    feeGrowthInside1X128 = feeGrowthGlobal1X128
      .sub(lower.feeGrowthOutside1X128)
      .sub(upper.feeGrowthOutside1X128);
  }
  const [tokensOwed0, tokensOwed1] = PositionLibrary.getTokensOwed(
    JSBI.BigInt(position.feeGrowthInside0LastX128.toString()),
    JSBI.BigInt(position.feeGrowthInside1LastX128.toString()),
    JSBI.BigInt(position.liquidity.toString()),
    JSBI.BigInt(feeGrowthInside0X128.toString()),
    JSBI.BigInt(feeGrowthInside1X128.toString()),
  );
  return {
    token0Amount: CurrencyAmount.fromRawAmount(
      basicPositionInfo.token0,
      position.tokensOwed0.add(tokensOwed0.toString()).toString(),
    ),
    token1Amount: CurrencyAmount.fromRawAmount(
      basicPositionInfo.token1,
      position.tokensOwed1.add(tokensOwed1.toString()).toString(),
    ),
  };
}

/**
 * Check whether the specified position is currently in range, i.e. pool price is within the position's price range.
 * @param position The position to check.
 * @returns A boolean indicating whether the position is in range.
 */
export function isPositionInRange(position: Position): boolean {
  return (
    position.pool.tickCurrent >= position.tickLower &&
    position.pool.tickCurrent < position.tickUpper
  );
}

/**
 * Lists all position ids owned by the specified owner.
 * @param owner The owner.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns List of all position ids of the specified owner.
 */
export async function getPositionIdsByOwner(
  owner: string,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<BigNumber[]> {
  const npm = getNPM(chainId, provider);
  const numPositions = (await npm.balanceOf(owner)).toNumber();
  return Promise.all(
    [...Array(numPositions).keys()].map((index) =>
      npm.tokenOfOwnerByIndex(owner, index),
    ),
  );
}

/**
 * Fetches basic info for all positions of the specified owner.
 * @param owner The owner.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns A map where each key is a position id and its associated value is BasicPositionInfo of that position.
 */
export async function getAllPositionBasicInfoByOwner(
  owner: string,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Map<string, BasicPositionInfo>> {
  const positionIds = await getPositionIdsByOwner(owner, chainId, provider);
  const positionInfos = await Promise.all(
    positionIds.map((positionId) =>
      getBasicPositionInfo(chainId, positionId, provider),
    ),
  );
  return new Map(
    positionIds.map((positionId, index) => [
      positionId.toString(),
      positionInfos[index],
    ]),
  );
}

/**
 * Get the state and pool for all positions of the specified owner by deploying an ephemeral contract via `eth_call`.
 * Each position consumes about 200k gas, so this method may fail if the number of positions exceeds 1500 assuming the
 * provider gas limit is 300m.
 * @param owner The owner.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns A map where each key is a position id and its associated value is PositionDetails of that position.
 */
export async function getAllPositionsDetails(
  owner: string,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Map<string, PositionDetails>> {
  const returnData = await provider.call(
    new EphemeralAllPositionsByOwner__factory().getDeployTransaction(
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
      owner,
    ),
  );
  const iface = EphemeralAllPositionsByOwner__factory.createInterface();
  const positions = iface.decodeFunctionResult(
    'allPositions',
    returnData,
  )[0] as PositionStateStructOutput[];
  return new Map(
    positions.map((pos) => {
      return [
        pos.tokenId.toString(),
        PositionDetails.fromPositionStateStruct(chainId, pos),
      ] as const;
    }),
  );
}

/**
 * Get the token SVG URL of the specified position.
 * @param chainId Chain id.
 * @param positionId Position id.
 * @param provider Ethers provider.
 * @returns A promise that resolves to the token SVG URL.
 */
export async function getTokenSvg(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  provider: Provider,
): Promise<URL> {
  const npm = getNPM(chainId, provider);
  const uri = await npm.tokenURI(positionId);
  const json_uri = Buffer.from(
    uri.replace('data:application/json;base64,', ''),
    'base64',
  ).toString('utf-8');
  return new URL(JSON.parse(json_uri).image);
}

/**
 * Predict the position after rebalance assuming the pool price remains the same.
 * @param position Position info before rebalance.
 * @param newTickLower The new lower tick.
 * @param newTickUpper The new upper tick.
 * @returns The position info after rebalance.
 */
export function getRebalancedPosition(
  position: Position,
  newTickLower: number,
  newTickUpper: number,
): Position {
  const price = getPoolPrice(position.pool);
  // Calculate the position equity denominated in token1 before rebalance.
  const equityInToken1Before = price
    .quote(position.amount0)
    .add(position.amount1);
  const equityBefore = fractionToBig(equityInToken1Before);
  const bigPrice = fractionToBig(price);
  const token0Proportion = getTokenValueProportionFromPriceRatio(
    newTickLower,
    newTickUpper,
    bigPrice,
  );
  const amount1After = new Big(1).sub(token0Proportion).mul(equityBefore);
  // token0's equity denominated in token1 divided by the price
  const amount0After = new Big(equityBefore).sub(amount1After).div(bigPrice);
  return Position.fromAmounts({
    pool: position.pool,
    tickLower: newTickLower,
    tickUpper: newTickUpper,
    amount0: amount0After.toFixed(0),
    amount1: amount1After.toFixed(0),
    useFullPrecision: false,
  });
}

/**
 * Predict the position if the pool price becomes the specified price.
 * @param position Position info.
 * @param newPrice The new pool price.
 * @returns The position info after the pool price becomes the specified price.
 */
export function getPositionAtPrice(
  position: Position,
  newPrice: Big,
): Position {
  const sqrtPriceX96 = priceToSqrtRatioX96(newPrice);
  const poolAtNewPrice = new Pool(
    position.pool.token0,
    position.pool.token1,
    position.pool.fee,
    sqrtPriceX96,
    position.pool.liquidity,
    TickMath.getTickAtSqrtRatio(sqrtPriceX96),
  );
  return new Position({
    pool: poolAtNewPrice,
    liquidity: position.liquidity,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
  });
}

/**
 * Predict the position after rebalance assuming the pool price becomes the specified price.
 * @param position Position info before rebalance.
 * @param newPrice The pool price at rebalance.
 * @param newTickLower The new lower tick.
 * @param newTickUpper The new upper tick.
 * @returns The position info after rebalance.
 */
export function projectRebalancedPositionAtPrice(
  position: Position,
  newPrice: Big,
  newTickLower: number,
  newTickUpper: number,
): Position {
  return getRebalancedPosition(
    getPositionAtPrice(position, newPrice),
    newTickLower,
    newTickUpper,
  );
}

/**
 * Contains the full position details including the corresponding pool and real-time collectable token amounts.
 */
export class PositionDetails implements BasicPositionInfo {
  public readonly tokenId: string;
  public readonly owner: string;
  public readonly token0: Token;
  public readonly token1: Token;
  public readonly fee: FeeAmount;
  public readonly liquidity: string;
  public readonly tickLower: number;
  public readonly tickUpper: number;
  public readonly pool: Pool;
  public readonly position: Position;
  private readonly _tokensOwed0: BigNumber;
  private readonly _tokensOwed1: BigNumber;

  private constructor(
    tokenId: BigNumberish,
    owner: string,
    basicPositionInfo: BasicPositionInfo,
    sqrtRatioX96: BigintIsh,
    tick: number,
    activeLiquidity: BigintIsh,
    tokensOwed0: BigNumber,
    tokensOwed1: BigNumber,
  ) {
    this.tokenId = tokenId.toString();
    this.owner = owner;
    this.token0 = basicPositionInfo.token0;
    this.token1 = basicPositionInfo.token1;
    this.fee = basicPositionInfo.fee;
    this.liquidity = basicPositionInfo.liquidity!.toString();
    this.tickLower = basicPositionInfo.tickLower;
    this.tickUpper = basicPositionInfo.tickUpper;
    this.pool = new Pool(
      this.token0,
      this.token1,
      this.fee,
      sqrtRatioX96.toString(),
      activeLiquidity.toString(),
      tick,
    );
    this.position = new Position({
      pool: this.pool,
      liquidity: this.liquidity,
      tickLower: this.tickLower,
      tickUpper: this.tickUpper,
    });
    this._tokensOwed0 = tokensOwed0;
    this._tokensOwed1 = tokensOwed1;
  }

  /**
   * Get the position details in a single call by deploying an ephemeral contract via `eth_call`
   * @param chainId Chain id.
   * @param positionId Position id.
   * @param provider Ethers provider.
   * @returns The position details.
   */
  public static async fromPositionId(
    chainId: ApertureSupportedChainId,
    positionId: BigNumberish,
    provider: Provider,
    blockTag?: BlockTag,
  ): Promise<PositionDetails> {
    const returnData = await provider.call(
      new EphemeralGetPosition__factory().getDeployTransaction(
        getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
        positionId,
      ),
      blockTag,
    );
    return PositionDetails.fromPositionStateStruct(
      chainId,
      EphemeralGetPosition__factory.createInterface().decodeFunctionResult(
        'getPosition',
        returnData,
      )[0],
    );
  }

  /**
   * Get the position details from the position state struct.
   * @param chainId The chain ID.
   * @param tokenId The token ID.
   * @param owner The position owner.
   * @param position NonfungiblePositionManager's position struct.
   * @param slot0 The pool's slot0 struct.
   * @param activeLiquidity The pool's active liquidity.
   * @param decimals0 token0's decimals.
   * @param decimals1 token1's decimals.
   * @returns The position details.
   */
  public static fromPositionStateStruct(
    chainId: ApertureSupportedChainId,
    {
      tokenId,
      owner,
      position,
      slot0,
      activeLiquidity,
      decimals0,
      decimals1,
    }: PositionStateStructOutput,
  ): PositionDetails {
    return new PositionDetails(
      tokenId,
      owner,
      {
        token0: new Token(chainId, position.token0, decimals0),
        token1: new Token(chainId, position.token1, decimals1),
        fee: position.fee,
        liquidity: position.liquidity.toString(),
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
      },
      slot0.sqrtPriceX96.toString(),
      slot0.tick,
      activeLiquidity.toString(),
      position.tokensOwed0,
      position.tokensOwed1,
    );
  }

  /**
   * Returns the chain ID of the tokens in the pool.
   */
  public get chainId(): number {
    return this.token0.chainId;
  }

  public get tokensOwed0(): CurrencyAmount<Token> {
    return CurrencyAmount.fromRawAmount(
      this.token0,
      this._tokensOwed0.toString(),
    );
  }

  public get tokensOwed1(): CurrencyAmount<Token> {
    return CurrencyAmount.fromRawAmount(
      this.token1,
      this._tokensOwed1.toString(),
    );
  }

  /**
   * Get the real-time collectable token amounts.
   * @param provider Ethers provider.
   */
  public async getCollectableTokenAmounts(
    provider: Provider,
  ): Promise<CollectableTokenAmounts> {
    return viewCollectableTokenAmounts(this.chainId, this.tokenId, provider, {
      token0: this.token0,
      token1: this.token1,
      fee: this.fee,
      tickLower: this.tickLower,
      tickUpper: this.tickUpper,
      liquidity: this.liquidity,
    });
  }
}

/**
 * Predict the change in liquidity and token amounts after a reinvestment without a prior approval.
 * https://github.com/dragonfly-xyz/useful-solidity-patterns/blob/main/patterns/eth_call-tricks/README.md#geth-overrides
 * @param chainId The chain ID.
 * @param positionId The position id.
 * @param provider The ethers provider.
 * @param blockNumber Optional block number to query.
 * @returns The predicted change in liquidity and token amounts.
 */
export async function getReinvestedPosition(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  provider: JsonRpcProvider,
  blockNumber?: number,
): Promise<{
  liquidity: BigNumber;
  amount0: BigNumber;
  amount1: BigNumber;
}> {
  const owner = await getNPM(chainId, provider).ownerOf(positionId, {
    blockTag: blockNumber,
  });
  const { functionFragment, data } = getAutomanReinvestCallInfo(
    positionId,
    Math.round(new Date().getTime() / 1000 + 60 * 10), // 10 minutes from now.
  );
  const returnData = await staticCallWithOverrides(
    {
      from: owner,
      to: getChainInfo(chainId).aperture_uniswap_v3_automan,
      data,
    },
    // forge an operator approval using state overrides.
    getNPMApprovalOverrides(chainId, owner),
    provider,
    blockNumber,
  );
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionFragment,
    returnData,
  ) as unknown as {
    liquidity: BigNumber;
    amount0: BigNumber;
    amount1: BigNumber;
  };
}
