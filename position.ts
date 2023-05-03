import { BigintIsh, Token } from '@uniswap/sdk-core';
import { Pool, Position, computePoolAddress } from '@uniswap/v3-sdk';
import { Provider } from '@ethersproject/abstract-provider';
import { CHAIN_ID_TO_INFO } from './chain';
import {
  ERC20__factory,
  INonfungiblePositionManager__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk/typechain-types';
import { getPoolFromBasicPositionInfo } from './pool';

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
  const chainInfo = CHAIN_ID_TO_INFO.get(chainId)!;
  const nonfungiblePositionManager =
    INonfungiblePositionManager__factory.connect(
      chainInfo.uniswap_v3_nonfungible_position_manager,
      provider,
    );
  const positionInfo = await nonfungiblePositionManager.positions(positionId);
  const token0Address = positionInfo.token0;
  const token1Address = positionInfo.token1;
  const token0Contract = ERC20__factory.connect(token0Address, provider);
  const token1Contract = ERC20__factory.connect(token1Address, provider);
  const [token0Decimals, token1Decimals] = await Promise.all([
    token0Contract.decimals(),
    token1Contract.decimals(),
  ]);
  const token0 = new Token(chainId, token0Address, token0Decimals);
  const token1 = new Token(chainId, token1Address, token1Decimals);
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
  provider: Provider,
): Promise<Position> {
  if (basicInfo.liquidity === undefined) {
    throw 'Missing position liquidity info';
  }
  return new Position({
    pool: await getPoolFromBasicPositionInfo(basicInfo, provider),
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
    provider,
  );
}
