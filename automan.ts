import {
  ApertureSupportedChainId,
  INonfungiblePositionManager,
  IUniV3Automan__factory,
  PermitInfo,
  UniV3Automan,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { FeeAmount, TICK_SPACINGS, nearestUsableTick } from '@uniswap/v3-sdk';
import { BigNumberish, BytesLike, Signer } from 'ethers';
import { solidityPack, splitSignature } from 'ethers/lib/utils';

import { getChainInfo } from './chain';
import {
  getNPMApprovalOverrides,
  getTokenOverrides,
  staticCallWithOverrides,
} from './overrides';

export type AutomanActionName =
  | 'decreaseLiquidity'
  | 'reinvest'
  | 'rebalance'
  | 'removeLiquidity(';
export type AutomanFragment = {
  [K in keyof UniV3Automan['functions']]: K extends `${AutomanActionName}${string}`
    ? K
    : never;
}[keyof UniV3Automan['functions']];

export type GetAutomanFragment<T extends AutomanActionName> = {
  [P in AutomanFragment]: P extends `${T}${string}` ? P : never;
}[AutomanFragment];

export type GetAutomanParams<T extends AutomanFragment> = Parameters<
  UniV3Automan['functions'][T]
>;

type AutomanCallInfo<T extends AutomanActionName> = {
  functionFragment: GetAutomanFragment<T>;
  data: string;
};

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type MintReturnType = UnwrapPromise<
  ReturnType<UniV3Automan['callStatic']['mintOptimal']>
>;

type RemoveLiquidityReturnType = UnwrapPromise<
  ReturnType<UniV3Automan['callStatic'][GetAutomanFragment<'removeLiquidity('>]>
>;

type RebalanceReturnType = UnwrapPromise<
  ReturnType<UniV3Automan['callStatic'][GetAutomanFragment<'rebalance'>]>
>;

export function getAutomanContract(
  chainId: ApertureSupportedChainId,
  provider: Provider | Signer,
) {
  return IUniV3Automan__factory.connect(
    getChainInfo(chainId).aperture_uniswap_v3_automan,
    provider,
  );
}

export function encodeSwapData(
  chainId: ApertureSupportedChainId,
  router: string,
  approveTarget: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: BigNumberish,
  data: BytesLike,
): string {
  return solidityPack(
    ['address', 'bytes'],
    [
      getChainInfo(chainId).aperture_router_proxy!,
      solidityPack(
        ['address', 'address', 'address', 'address', 'uint256', 'bytes'],
        [router, approveTarget, tokenIn, tokenOut, amountIn, data],
      ),
    ],
  );
}

export function encodeOptimalSwapData(
  chainId: ApertureSupportedChainId,
  token0: string,
  token1: string,
  fee: FeeAmount,
  tickLower: number,
  tickUpper: number,
  zeroForOne: boolean,
  approveTarget: string,
  router: string,
  data: BytesLike,
): string {
  return solidityPack(
    ['address', 'bytes'],
    [
      getChainInfo(chainId).optimal_swap_router!,
      solidityPack(
        // prettier-ignore
        ['address', 'address', 'uint24', 'int24', 'int24', 'bool', 'address', 'address', 'bytes'],
        // prettier-ignore
        [token0, token1, fee, tickLower, tickUpper, zeroForOne, approveTarget, router, data],
      ),
    ],
  );
}

export function getAutomanDecreaseLiquidityCallInfo(
  positionId: BigNumberish,
  liquidity: BigNumberish,
  deadline: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
): AutomanCallInfo<'decreaseLiquidity'> {
  const params: INonfungiblePositionManager.DecreaseLiquidityParamsStruct = {
    tokenId: positionId,
    liquidity,
    amount0Min,
    amount1Min,
    deadline,
  };
  if (permitInfo === undefined) {
    const functionFragment =
      'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256),uint256)';
    return {
      functionFragment,
      data: IUniV3Automan__factory.createInterface().encodeFunctionData(
        functionFragment,
        [params, feeBips],
      ),
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  const functionFragment =
    'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256),uint256,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [
        params,
        feeBips,
        permitInfo.deadline,
        permitSignature.v,
        permitSignature.r,
        permitSignature.s,
      ],
    ),
  };
}

export function getAutomanRebalanceCallInfo(
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  existingPositionId: BigNumberish,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
  swapData: BytesLike = '0x',
): AutomanCallInfo<'rebalance'> {
  if (permitInfo === undefined) {
    const functionFragment =
      'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes)';
    return {
      functionFragment,
      data: IUniV3Automan__factory.createInterface().encodeFunctionData(
        functionFragment,
        [mintParams, existingPositionId, feeBips, swapData],
      ),
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  const functionFragment =
    'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [
        mintParams,
        existingPositionId,
        feeBips,
        swapData,
        permitInfo.deadline,
        permitSignature.v,
        permitSignature.r,
        permitSignature.s,
      ],
    ),
  };
}

export function getAutomanReinvestCallInfo(
  positionId: BigNumberish,
  deadline: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
  swapData: BytesLike = '0x',
): AutomanCallInfo<'reinvest'> {
  const increaseLiquidityParams: INonfungiblePositionManager.IncreaseLiquidityParamsStruct =
    {
      tokenId: positionId,
      amount0Desired: 0, // Param value ignored by Automan.
      amount1Desired: 0, // Param value ignored by Automan.
      amount0Min,
      amount1Min,
      deadline,
    };
  if (permitInfo === undefined) {
    const functionFragment =
      'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes)';
    return {
      functionFragment,
      data: IUniV3Automan__factory.createInterface().encodeFunctionData(
        functionFragment,
        [increaseLiquidityParams, feeBips, swapData],
      ),
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  const functionFragment =
    'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [
        increaseLiquidityParams,
        feeBips,
        swapData,
        permitInfo.deadline,
        permitSignature.v,
        permitSignature.r,
        permitSignature.s,
      ],
    ),
  };
}

export function getAutomanRemoveLiquidityCallInfo(
  tokenId: BigNumberish,
  deadline: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
): AutomanCallInfo<'removeLiquidity('> {
  const decreaseLiquidityParams: INonfungiblePositionManager.DecreaseLiquidityParamsStruct =
    {
      tokenId,
      liquidity: 0, // Param value ignored by Automan.
      amount0Min,
      amount1Min,
      deadline,
    };
  if (permitInfo === undefined) {
    const functionFragment =
      'removeLiquidity((uint256,uint128,uint256,uint256,uint256),uint256)';
    return {
      functionFragment,
      data: IUniV3Automan__factory.createInterface().encodeFunctionData(
        functionFragment,
        [decreaseLiquidityParams, feeBips],
      ),
    };
  }
  const permitSignature = splitSignature(permitInfo.signature);
  const functionFragment =
    'removeLiquidity((uint256,uint128,uint256,uint256,uint256),uint256,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [
        decreaseLiquidityParams,
        feeBips,
        permitInfo.deadline,
        permitSignature.v,
        permitSignature.r,
        permitSignature.s,
      ],
    ),
  };
}

function checkTicks(mintParams: INonfungiblePositionManager.MintParamsStruct) {
  const tickLower = Number(mintParams.tickLower.toString());
  const tickUpper = Number(mintParams.tickUpper.toString());
  const fee = mintParams.fee as FeeAmount;
  if (
    tickLower !== nearestUsableTick(tickLower, TICK_SPACINGS[fee]) ||
    tickUpper !== nearestUsableTick(tickUpper, TICK_SPACINGS[fee])
  ) {
    throw new Error('tickLower or tickUpper not valid');
  }
}

/**
 * Simulate a `mintOptimal` call by overriding the balances and allowances of the tokens involved.
 * @param chainId The chain ID.
 * @param provider A JSON RPC provider or a base provider.
 * @param from The address to simulate the call from.
 * @param mintParams The mint parameters.
 * @param swapData The swap data if using a router.
 * @param blockNumber Optional block number to query.
 * @returns {tokenId, liquidity, amount0, amount1}
 */
export async function simulateMintOptimal(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  from: string,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  swapData: BytesLike = '0x',
  blockNumber?: number,
): Promise<MintReturnType> {
  checkTicks(mintParams);
  const data = IUniV3Automan__factory.createInterface().encodeFunctionData(
    'mintOptimal',
    [mintParams, swapData],
  );
  const tx = {
    from,
    to: getChainInfo(chainId).aperture_uniswap_v3_automan,
    data,
  };
  let returnData: string;
  if (provider instanceof JsonRpcProvider) {
    returnData = await staticCallWithOverrides(
      tx,
      // forge token approvals and balances
      await getTokenOverrides(
        chainId,
        provider,
        from,
        mintParams.token0,
        mintParams.token1,
        mintParams.amount0Desired,
        mintParams.amount1Desired,
      ),
      provider,
      blockNumber,
    );
  } else {
    returnData = await provider.call(tx, blockNumber);
  }
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    'mintOptimal',
    returnData,
  ) as MintReturnType;
}

/**
 * Simulate a `removeLiquidity` call.
 * @param chainId The chain ID.
 * @param provider A JSON RPC provider or a base provider.
 * @param from The address to simulate the call from.
 * @param tokenId The token ID of the position to burn.
 * @param amount0Min The minimum amount of token0 to receive.
 * @param amount1Min The minimum amount of token1 to receive.
 * @param feeBips The percentage of position value to pay as a fee, multiplied by 1e18.
 * @param blockNumber Optional block number to query.
 */
export async function simulateRemoveLiquidity(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  from: string,
  tokenId: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  blockNumber?: number,
): Promise<RemoveLiquidityReturnType> {
  const { functionFragment, data } = getAutomanRemoveLiquidityCallInfo(
    tokenId,
    Math.floor(Date.now() / 1000 + 60 * 30),
    amount0Min,
    amount1Min,
    feeBips,
  );
  const tx = {
    from,
    to: getChainInfo(chainId).aperture_uniswap_v3_automan,
    data,
  };
  let returnData: string;
  if (provider instanceof JsonRpcProvider) {
    returnData = await staticCallWithOverrides(
      tx,
      getNPMApprovalOverrides(chainId, from),
      provider,
      blockNumber,
    );
  } else {
    returnData = await provider.call(tx, blockNumber);
  }
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionFragment,
    returnData,
  ) as RemoveLiquidityReturnType;
}

/**
 * Simulate a `rebalance` call.
 * @param chainId The chain ID.
 * @param provider A JSON RPC provider or a base provider.
 * @param from The address to simulate the call from.
 * @param mintParams The mint parameters.
 * @param tokenId The token ID of the position to rebalance.
 * @param feeBips The percentage of position value to pay as a fee, multiplied by 1e18.
 * @param swapData The swap data if using a router.
 * @param blockNumber Optional block number to query.
 */
export async function simulateRebalance(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  from: string,
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  tokenId: BigNumberish,
  feeBips: BigNumberish = 0,
  swapData: BytesLike = '0x',
  blockNumber?: number,
): Promise<RebalanceReturnType> {
  checkTicks(mintParams);
  const { functionFragment, data } = getAutomanRebalanceCallInfo(
    mintParams,
    tokenId,
    feeBips,
    undefined,
    swapData,
  );
  const tx = {
    from,
    to: getChainInfo(chainId).aperture_uniswap_v3_automan,
    data,
  };
  let returnData: string;
  if (provider instanceof JsonRpcProvider) {
    returnData = await staticCallWithOverrides(
      {
        from,
        to: getChainInfo(chainId).aperture_uniswap_v3_automan,
        data,
      },
      getNPMApprovalOverrides(chainId, from),
      provider,
      blockNumber,
    );
  } else {
    returnData = await provider.call(tx, blockNumber);
  }
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionFragment,
    returnData,
  ) as RebalanceReturnType;
}
