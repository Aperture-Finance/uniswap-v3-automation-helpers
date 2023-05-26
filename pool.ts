import { Provider } from '@ethersproject/abstract-provider';
import {
  FeeAmount,
  Pool,
  TICK_SPACINGS,
  computePoolAddress,
} from '@uniswap/v3-sdk';
import { BasicPositionInfo } from './position';
import {
  ApertureSupportedChainId,
  IUniswapV3Pool__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { getChainInfo } from './chain';
import { Token } from '@uniswap/sdk-core';
import axios from 'axios';
import {
  AllV3TicksQuery,
  FeeTierDistributionQuery,
} from './data/__graphql_generated__/uniswap-thegraph-types-and-hooks';
import JSBI from 'jsbi';

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

/**
 * Fetches the TVL distribution of the different fee tiers behind the specified token pair.
 * Implementation heavily adapted from https://github.com/Uniswap/interface/blob/bd4042aa16cbd035f4b543272ef9ae301c96e8c9/src/hooks/useFeeTierDistribution.ts#L76.
 * @param chainId Chain id.
 * @param tokenA Address of one of the tokens in the pool.
 * @param tokenB Address of the other token in the pool.
 * @returns A record with four entries where the keys are the fee tiers and the values are the TVL fractions with the corresponding fee tiers.
 */
export async function getFeeTierDistribution(
  chainId: ApertureSupportedChainId,
  tokenA: string,
  tokenB: string,
): Promise<Record<FeeAmount, number>> {
  const subgraph_url = getChainInfo(chainId).uniswap_subgraph_url;
  if (subgraph_url === undefined) {
    throw 'Subgraph URL is not defined for the specified chain id';
  }
  const [token0, token1] = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  const feeTierTotalValueLocked: FeeTierDistributionQuery = (
    await axios.post(subgraph_url, {
      operationName: 'FeeTierDistribution',
      variables: {
        token0,
        token1,
      },
      query: `
        query FeeTierDistribution($token0: String!, $token1: String!) {
          _meta {
            block {
              number
            }
          }
          feeTierTVL: pools(
            orderBy: totalValueLockedToken0
            orderDirection: desc
            where: { token0: $token0, token1: $token1 }
          ) {
            feeTier
            totalValueLockedToken0
            totalValueLockedToken1
          }
        }`,
    })
  ).data.data;
  const feeTierToTVL = new Map<FeeAmount, number>();
  let sumTVL = 0;
  for (const feeTierTVL of feeTierTotalValueLocked.feeTierTVL) {
    const feeAmount = Number(feeTierTVL.feeTier) as FeeAmount;
    if (!(feeAmount in FeeAmount)) continue;
    const token0TVL = Number(feeTierTVL.totalValueLockedToken0 ?? 0);
    const token1TVL = Number(feeTierTVL.totalValueLockedToken1 ?? 0);
    feeTierToTVL.set(feeAmount, token0TVL + token1TVL);
    sumTVL += token0TVL + token1TVL;
  }
  const getFeeTierFraction = (feeAmount: FeeAmount): number => {
    return (feeTierToTVL.get(feeAmount) ?? 0) / sumTVL;
  };
  return {
    [FeeAmount.LOWEST]: getFeeTierFraction(FeeAmount.LOWEST),
    [FeeAmount.LOW]: getFeeTierFraction(FeeAmount.LOW),
    [FeeAmount.MEDIUM]: getFeeTierFraction(FeeAmount.MEDIUM),
    [FeeAmount.HIGH]: getFeeTierFraction(FeeAmount.HIGH),
  };
}

export type TickNumber = number;
export type LiquidityAmount = JSBI;

/**
 * Fetches the liquidity for all ticks for the specified pool.
 * @param chainId Chain id.
 * @param pool The liquidity pool to fetch the tick to liquidity map for.
 * @returns A map from tick numbers to liquidity amounts for the specified pool.
 */
export async function getTickToLiquidityMapForPool(
  chainId: ApertureSupportedChainId,
  pool: Pool,
): Promise<Map<TickNumber, LiquidityAmount>> {
  if (chainId !== ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID) {
    throw 'Unsupported chain id for fetching liquidity for all ticks from subgraph';
  }
  let rawData: AllV3TicksQuery['ticks'] = [];
  const numTicksPerQuery = 2000;
  const chainInfo = getChainInfo(chainId);
  const poolAddress = computePoolAddress({
    factoryAddress: chainInfo.uniswap_v3_factory,
    tokenA: pool.token0,
    tokenB: pool.token1,
    fee: pool.fee,
  }).toLowerCase();
  for (let skip = 0; ; skip += numTicksPerQuery) {
    const response: AllV3TicksQuery | undefined = (
      await axios.post(chainInfo.uniswap_subgraph_url!, {
        operationName: 'AllV3Ticks',
        variables: {
          poolAddress,
          skip,
        },
        query: `
          query AllV3Ticks($poolAddress: String, $skip: Int!) {
            ticks(first: 1000, skip: $skip, where: { poolAddress: $poolAddress }, orderBy: tickIdx) {
              tick: tickIdx
              liquidityNet
            }
          }
        `,
      })
    ).data.data;
    const numItems = response?.ticks.length ?? 0;
    if (numItems > 0) {
      rawData = rawData.concat(response!.ticks);
    }
    // We fetch 1000 items per query, so if we get less than that, then we know that we have fetched all the items.
    if (numItems < numTicksPerQuery) {
      break;
    }
  }

  const data = new Map<TickNumber, LiquidityAmount>();
  if (rawData.length > 0) {
    rawData.sort((a, b) => Number(a.tick) - Number(b.tick));
    let currentLiquidity = JSBI.BigInt(0);
    let rawDataIndex = 0;
    // TODO: For plotting we don't need a datapoint for each tick spacing. Consider decreasing the size of the returned map.
    for (
      let tick = Number(rawData[0].tick);
      rawDataIndex < rawData.length;
      tick += TICK_SPACINGS[pool.fee]
    ) {
      if (tick === Number(rawData[rawDataIndex].tick)) {
        currentLiquidity = JSBI.add(
          currentLiquidity,
          JSBI.BigInt(rawData[rawDataIndex].liquidityNet as string),
        );
        rawDataIndex++;
      }
      data.set(tick, currentLiquidity);
    }
  }
  return data;
}
