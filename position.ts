import { BigintIsh, Token } from '@uniswap/sdk-core';
import { Pool, Position, computePoolAddress } from '@uniswap/v3-sdk';
import { ethers } from 'ethers';
import { Provider } from '@ethersproject/abstract-provider';
import { providers } from '@0xsequence/multicall';
import { CHAIN_ID_TO_INFO } from './chain';
import {
  ERC20__factory,
  INonfungiblePositionManager__factory,
  IUniswapV3Pool__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk/typechain-types';

interface BasicPositionInfo {
  poolAddress: string;
  token0: Token;
  token1: Token;
  liquidity: BigintIsh;
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
    poolAddress: computePoolAddress({
      factoryAddress: chainInfo.uniswap_v3_factory,
      tokenA: token0,
      tokenB: token1,
      fee: positionInfo.fee,
    }),
  };
}

export async function getUniswapSDKPositionFromBasicInfo(
  basicInfo: BasicPositionInfo,
  provider: Provider,
): Promise<Position> {
  const poolContract = IUniswapV3Pool__factory.connect(
    basicInfo.poolAddress,
    provider,
  );
  const slot0 = await poolContract.slot0();
  return new Position({
    pool: new Pool(
      basicInfo.token0,
      basicInfo.token1,
      basicInfo.fee,
      slot0.sqrtPriceX96.toString(),
      basicInfo.liquidity,
      slot0.tick,
    ),
    liquidity: basicInfo.liquidity,
    tickLower: basicInfo.tickLower,
    tickUpper: basicInfo.tickUpper,
  });
}

export async function getUniswapSDKPosition(
  chainId: number,
  positionId: number,
  provider?: Provider,
) {
  // If `provider` is undefined, we use the public Infura node.
  if (provider === undefined) {
    provider = new providers.MulticallProvider(
      new ethers.providers.InfuraProvider(
        CHAIN_ID_TO_INFO.get(chainId)!.infura_network_id!,
      ),
    );
  }
  return getUniswapSDKPositionFromBasicInfo(
    await getBasicPositionInfo(chainId, positionId, provider),
    provider,
  );
}
