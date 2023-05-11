import { Provider } from '@ethersproject/abstract-provider';
import { FeeAmount, Pool, computePoolAddress } from '@uniswap/v3-sdk';
import { BasicPositionInfo } from './position';
import { IUniswapV3Pool__factory } from '@aperture_finance/uniswap-v3-automation-sdk';
import { ApertureSupportedChainId, getChainInfo } from './chain';
import { Token } from '@uniswap/sdk-core';

/**
 * Constructs a Uniswap SDK Pool object for the pool behind the specified position.
 * @param basicInfo Basic position info.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns The constructed Uniswap SDK Pool object where the specified position resides.
 */
export async function getPoolFromBasicPositionInfo(
  basicInfo: BasicPositionInfo,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Pool> {
  const chainInfo = getChainInfo(chainId);
  const poolContract = IUniswapV3Pool__factory.connect(
    computePoolAddress({
      factoryAddress: chainInfo.uniswap_v3_factory,
      tokenA: basicInfo.token0,
      tokenB: basicInfo.token1,
      fee: basicInfo.fee,
    }),
    provider,
  );
  const [slot0, inRangeLiquidity] = await Promise.all([
    poolContract.slot0(),
    poolContract.liquidity(),
  ]);
  return new Pool(
    basicInfo.token0,
    basicInfo.token1,
    basicInfo.fee,
    slot0.sqrtPriceX96.toString(),
    inRangeLiquidity.toString(),
    slot0.tick,
  );
}

/**
 * Constructs a Uniswap SDK Pool object for an existing and initialized pool.
 * Note that the constructed pool's `token0` and `token1` will be sorted, but the input `tokenA` and `tokenB` don't have to be.
 * @param tokenA One of the tokens in the pool.
 * @param tokenB The other token in the pool.
 * @param fee Fee tier of the pool.
 * @param chainId Chain id.
 * @param provider Ethers provider.
 * @returns The constructed Uniswap SDK Pool object.
 */
export async function getPool(
  tokenA: Token,
  tokenB: Token,
  fee: FeeAmount,
  chainId: ApertureSupportedChainId,
  provider: Provider,
): Promise<Pool> {
  const poolContract = IUniswapV3Pool__factory.connect(
    computePoolAddress({
      factoryAddress: getChainInfo(chainId).uniswap_v3_factory,
      tokenA,
      tokenB,
      fee,
    }),
    provider,
  );
  // If the specified pool has not been created yet, then the slot0() and liquidity() calls should fail (and throw an error).
  const [slot0, inRangeLiquidity] = await Promise.all([
    poolContract.slot0(),
    poolContract.liquidity(),
  ]);
  if (slot0.sqrtPriceX96.isZero()) {
    throw 'Pool has been created but not yet initialized';
  }
  return new Pool(
    tokenA,
    tokenB,
    fee,
    slot0.sqrtPriceX96.toString(),
    inRangeLiquidity.toString(),
    slot0.tick,
  );
}
