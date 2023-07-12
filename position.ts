import {
  ApertureSupportedChainId,
  INonfungiblePositionManager__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import {
  CollectEventObject,
  DecreaseLiquidityEventObject,
} from '@aperture_finance/uniswap-v3-automation-sdk/dist/typechain-types/@aperture_finance/uni-v3-lib/src/interfaces/INonfungiblePositionManager';
import { Provider, TransactionReceipt } from '@ethersproject/abstract-provider';
import { BigintIsh, CurrencyAmount, Token } from '@uniswap/sdk-core';
import { FeeAmount, Pool, Position, TickMath } from '@uniswap/v3-sdk';
import Big from 'big.js';
import { BigNumber, BigNumberish, Signer, utils } from 'ethers';

import { getChainInfo } from './chain';
import { getToken } from './currency';
import { getPool, getPoolFromBasicPositionInfo, getPoolPrice } from './pool';
import {
  fractionToBig,
  getTokenValueProportionFromPriceRatio,
  priceToSqrtRatioX96,
} from './price';
import {
  EphemeralAllPositions__factory,
  EphemeralGetPosition__factory,
} from './typechain-types';
import { PositionStateStructOutput } from './typechain-types/src/lens/EphemeralPositionLens.sol/EphemeralGetPosition';

export interface BasicPositionInfo {
  token0: Token;
  token1: Token;
  fee: FeeAmount;
  liquidity?: BigintIsh;
  tickLower: number;
  tickUpper: number;
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
): Promise<BasicPositionInfo> {
  const npm = getNPM(chainId, provider);
  const positionInfo = await npm.positions(positionId);
  const [token0, token1] = await Promise.all([
    getToken(positionInfo.token0, chainId, provider),
    getToken(positionInfo.token1, chainId, provider),
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

export async function getPosition(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  provider: Provider,
) {
  const npm = getNPM(chainId, provider);
  const positionInfo = await npm.positions(positionId);
  const pool = await getPool(
    positionInfo.token0,
    positionInfo.token1,
    positionInfo.fee,
    chainId,
    provider,
  );
  return new Position({
    pool,
    liquidity: positionInfo.liquidity.toString(),
    tickLower: positionInfo.tickLower,
    tickUpper: positionInfo.tickUpper,
  });
}

export interface CollectableTokenAmounts {
  token0Amount: CurrencyAmount<Token>;
  token1Amount: CurrencyAmount<Token>;
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
 * View the amount of collectable tokens in a position.
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
): Promise<CollectableTokenAmounts> {
  const constructorArgs = utils.defaultAbiCoder.encode(
    ['address', 'uint256'],
    [getChainInfo(chainId).uniswap_v3_nonfungible_position_manager, positionId],
  );
  // Get the position state by deploying an ephemeral contract via `eth_call`
  // TODO: test multicall
  const returnData = await provider.call({
    data: utils.hexConcat([
      EphemeralGetPosition__factory.bytecode,
      constructorArgs,
    ]),
  });
  const iface = EphemeralGetPosition__factory.createInterface();
  const { position } = iface.decodeFunctionResult(
    'getPosition',
    returnData,
  )[0] as PositionStateStructOutput;

  let token0: Token, token1: Token;
  if (basicPositionInfo === undefined) {
    [token0, token1] = await Promise.all([
      getToken(position.token0, chainId, provider),
      getToken(position.token1, chainId, provider),
    ]);
  } else {
    token0 = basicPositionInfo.token0;
    token1 = basicPositionInfo.token1;
  }

  return {
    token0Amount: CurrencyAmount.fromRawAmount(
      token0,
      position.tokensOwed0.toString(),
    ),
    token1Amount: CurrencyAmount.fromRawAmount(
      token1,
      position.tokensOwed1.toString(),
    ),
  };
}

/**
 * Get the collected fees in the position from a transaction receipt.
 * @param chainId Chain id.
 * @param positionId Position id.
 * @param receipt Transaction receipt.
 * @param provider Ethers provider.
 * @param token0Address Checksum address of token0 in the position.
 * @param token1Address Checksum address of token1 in the position.
 * @returns A promise that resolves to the collected amount of the two tokens in the position.
 */
export async function getCollectedFeesFromReceipt(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  receipt: TransactionReceipt,
  provider: Provider,
  token0Address: string,
  token1Address: string,
): Promise<CollectableTokenAmounts> {
  const npmInterface = INonfungiblePositionManager__factory.createInterface();
  let collectArgs: CollectEventObject;
  let decreaseLiquidityArgs: DecreaseLiquidityEventObject | undefined;
  for (const log of receipt.logs) {
    try {
      const event = npmInterface.parseLog(log);
      if (event.name === 'Collect') {
        collectArgs = event.args as unknown as CollectEventObject;
      } else if (event.name === 'DecreaseLiquidity') {
        decreaseLiquidityArgs =
          event.args as unknown as DecreaseLiquidityEventObject;
      }
    } catch (e) {}
  }
  const principal0 = decreaseLiquidityArgs?.amount0 ?? 0;
  const principal1 = decreaseLiquidityArgs?.amount1 ?? 0;
  const total0 = collectArgs!.amount0;
  const total1 = collectArgs!.amount1;
  const [token0, token1] = await Promise.all([
    getToken(token0Address, chainId, provider),
    getToken(token1Address, chainId, provider),
  ]);
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
 * Fetches the state and pool for all positions of the specified owner.
 * @param owner The owner.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns A map where each key is a position id and its associated state and pool.
 */
export async function getAllPositions(
  owner: string,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Map<string, Position>> {
  const constructorArgs = utils.defaultAbiCoder.encode(
    ['address', 'address'],
    [getChainInfo(chainId).uniswap_v3_nonfungible_position_manager, owner],
  );
  // Get all position states by deploying an ephemeral contract via `eth_call`
  const returnData = await provider.call({
    data: utils.hexConcat([
      EphemeralAllPositions__factory.bytecode,
      constructorArgs,
    ]),
  });
  const iface = EphemeralAllPositions__factory.createInterface();
  const [tokenIds, positions] = iface.decodeFunctionResult(
    'allPositions',
    returnData,
  ) as [BigNumber[], PositionStateStructOutput[]];
  return new Map(
    tokenIds.map((tokenId, index) => {
      const pos = positions[index];
      return [
        tokenId.toString(),
        new Position({
          pool: new Pool(
            new Token(chainId, pos.position.token0, pos.decimals0),
            new Token(chainId, pos.position.token1, pos.decimals1),
            pos.position.fee,
            pos.slot0.sqrtPriceX96.toString(),
            pos.activeLiquidity.toString(),
            pos.slot0.tick,
          ),
          liquidity: pos.position.liquidity.toString(),
          tickLower: pos.position.tickLower,
          tickUpper: pos.position.tickUpper,
        }),
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
