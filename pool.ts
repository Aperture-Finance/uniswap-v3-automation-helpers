import { Provider } from '@ethersproject/abstract-provider';
import { Pool, computePoolAddress } from '@uniswap/v3-sdk';
import { BasicPositionInfo } from './position';
import { IUniswapV3Pool__factory } from '@aperture_finance/uniswap-v3-automation-sdk';
import { getChainInfo } from './chain';

export async function getPoolFromBasicPositionInfo(
  basicInfo: BasicPositionInfo,
  chainId: number,
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