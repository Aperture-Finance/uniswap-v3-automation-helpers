import { BigintIsh, CurrencyAmount, Token } from '@uniswap/sdk-core';
import { Position } from '@uniswap/v3-sdk';
import { Provider } from '@ethersproject/abstract-provider';
import { getChainInfo } from './chain';
import { INonfungiblePositionManager__factory } from '@aperture_finance/uniswap-v3-automation-sdk/typechain-types';
import { getPoolFromBasicPositionInfo } from './pool';
import { getToken } from './currency';
import { BigNumber } from 'ethers';

export interface BasicPositionInfo {
  token0: Token;
  token1: Token;
  liquidity?: BigintIsh;
  tickLower: number;
  tickUpper: number;
  fee: number;
}

export async function getBasicPositionInfo(
  chainId: number,
  positionId: number,
  provider: Provider,
): Promise<BasicPositionInfo> {
  const chainInfo = getChainInfo(chainId);
  const nonfungiblePositionManager =
    INonfungiblePositionManager__factory.connect(
      chainInfo.uniswap_v3_nonfungible_position_manager,
      provider,
    );
  const positionInfo = await nonfungiblePositionManager.positions(positionId);
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

export async function getUniswapSDKPositionFromBasicInfo(
  basicInfo: BasicPositionInfo,
  chainId: number,
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

export async function getUniswapSDKPosition(
  chainId: number,
  positionId: number,
  provider: Provider,
) {
  return getUniswapSDKPositionFromBasicInfo(
    await getBasicPositionInfo(chainId, positionId, provider),
    chainId,
    provider,
  );
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
  chainId: number,
  positionId: number,
  provider: Provider,
  basicPositionInfo?: BasicPositionInfo,
): Promise<{
  token0Amount: CurrencyAmount<Token>;
  token1Amount: CurrencyAmount<Token>;
}> {
  if (basicPositionInfo === undefined) {
    basicPositionInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      provider,
    );
  }
  const chainInfo = getChainInfo(chainId);
  const npm = INonfungiblePositionManager__factory.connect(
    chainInfo.uniswap_v3_nonfungible_position_manager,
    provider,
  );
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
