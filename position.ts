import {
  ApertureSupportedChainId,
  INonfungiblePositionManager__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import {
  CollectEventObject,
  DecreaseLiquidityEventObject,
} from '@aperture_finance/uniswap-v3-automation-sdk/typechain-types/src/interfaces/INonfungiblePositionManager';
import { Provider, TransactionReceipt } from '@ethersproject/abstract-provider';
import { BigintIsh, CurrencyAmount, Token } from '@uniswap/sdk-core';
import { FeeAmount, Position } from '@uniswap/v3-sdk';
import { BigNumber, BigNumberish } from 'ethers';
import { getChainInfo } from './chain';
import { getToken } from './currency';
import { getPoolFromBasicPositionInfo } from './pool';

export interface BasicPositionInfo {
  token0: Token;
  token1: Token;
  liquidity?: BigintIsh;
  tickLower: number;
  tickUpper: number;
  fee: FeeAmount;
}

function getNPM(chainId: ApertureSupportedChainId, provider: Provider) {
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
  return getPositionFromBasicInfo(
    await getBasicPositionInfo(chainId, positionId, provider),
    chainId,
    provider,
  );
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
 * Get the collected fees in the position from a transaction receipt.
 * @param chainId Chain id.
 * @param positionId Position id.
 * @param receipt Transaction receipt.
 * @param provider Ethers provider.
 * @param basicPositionInfo Basic position info, optional; if undefined, one will be constructed.
 * @returns A promise that resolves to the collected amount of the two tokens in the position.
 */
export async function getCollectedFeesFromReceipt(
  chainId: ApertureSupportedChainId,
  positionId: BigNumberish,
  receipt: TransactionReceipt,
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
  return {
    token0Amount: CurrencyAmount.fromRawAmount(
      basicPositionInfo.token0,
      total0.sub(principal0).toString(),
    ),
    token1Amount: CurrencyAmount.fromRawAmount(
      basicPositionInfo.token1,
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
 * Fetches basic info of all positions of the specified owner.
 * @param owner The owner.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns A map where each key is a position id and its associated value is BasicPositionInfo of that position.
 */
export async function getAllPositionBasicInfoByOwner(
  owner: string,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Map<BigNumber, BasicPositionInfo>> {
  const positionIds = await getPositionIdsByOwner(owner, chainId, provider);
  const positionInfos = await Promise.all(
    positionIds.map((positionId) =>
      getBasicPositionInfo(chainId, positionId, provider),
    ),
  );
  return new Map(
    positionIds.map((positionId, index) => [positionId, positionInfos[index]]),
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
