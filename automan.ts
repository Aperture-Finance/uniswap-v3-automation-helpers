import {
  ApertureSupportedChainId,
  INonfungiblePositionManager,
  IUniV3Automan__factory,
  PermitInfo,
  UniV3Automan,
  getChainInfo,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider, Provider } from '@ethersproject/providers';
import { FeeAmount, TICK_SPACINGS, nearestUsableTick } from '@uniswap/v3-sdk';
import { BigNumberish, BytesLike, Signer } from 'ethers';
import { solidityPack, splitSignature } from 'ethers/lib/utils';

import {
  getERC20Overrides,
  getNPMApprovalOverrides,
  staticCallWithOverrides,
  tryStaticCallWithOverrides,
} from './overrides';

export type AutomanActionName =
  | 'decreaseLiquidity'
  | 'decreaseLiquiditySingle'
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

type DecreaseLiquiditySingleReturnType = UnwrapPromise<
  ReturnType<
    UniV3Automan['callStatic'][GetAutomanFragment<'decreaseLiquiditySingle'>]
  >
>;

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
  tokenId: BigNumberish,
  liquidity: BigNumberish,
  deadline: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
): AutomanCallInfo<'decreaseLiquidity'> {
  const params: INonfungiblePositionManager.DecreaseLiquidityParamsStruct = {
    tokenId,
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
  const { v, r, s } = splitSignature(permitInfo.signature);
  const functionFragment =
    'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256),uint256,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [params, feeBips, permitInfo.deadline, v, r, s],
    ),
  };
}

export function getAutomanDecreaseLiquiditySingleCallInfo(
  tokenId: BigNumberish,
  liquidity: BigNumberish,
  zeroForOne: boolean,
  deadline: BigNumberish,
  amountMin: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
  swapData: BytesLike = '0x',
): AutomanCallInfo<'decreaseLiquiditySingle'> {
  const params: INonfungiblePositionManager.DecreaseLiquidityParamsStruct = {
    tokenId,
    liquidity,
    amount0Min: zeroForOne ? 0 : amountMin,
    amount1Min: zeroForOne ? amountMin : 0,
    deadline,
  };
  if (permitInfo === undefined) {
    const functionFragment =
      'decreaseLiquiditySingle((uint256,uint128,uint256,uint256,uint256),bool,uint256,bytes)';
    return {
      functionFragment,
      data: IUniV3Automan__factory.createInterface().encodeFunctionData(
        functionFragment,
        [params, zeroForOne, feeBips, swapData],
      ),
    };
  }
  const { v, r, s } = splitSignature(permitInfo.signature);
  const functionFragment =
    'decreaseLiquiditySingle((uint256,uint128,uint256,uint256,uint256),bool,uint256,bytes,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [params, zeroForOne, feeBips, swapData, permitInfo.deadline, v, r, s],
    ),
  };
}

export function getAutomanRebalanceCallInfo(
  mintParams: INonfungiblePositionManager.MintParamsStruct,
  tokenId: BigNumberish,
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
        [mintParams, tokenId, feeBips, swapData],
      ),
    };
  }
  const { v, r, s } = splitSignature(permitInfo.signature);
  const functionFragment =
    'rebalance((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256),uint256,uint256,bytes,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [mintParams, tokenId, feeBips, swapData, permitInfo.deadline, v, r, s],
    ),
  };
}

export function getAutomanReinvestCallInfo(
  tokenId: BigNumberish,
  deadline: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  permitInfo?: PermitInfo,
  swapData: BytesLike = '0x',
): AutomanCallInfo<'reinvest'> {
  const params: INonfungiblePositionManager.IncreaseLiquidityParamsStruct = {
    tokenId,
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
        [params, feeBips, swapData],
      ),
    };
  }
  const { v, r, s } = splitSignature(permitInfo.signature);
  const functionFragment =
    'reinvest((uint256,uint256,uint256,uint256,uint256,uint256),uint256,bytes,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [params, feeBips, swapData, permitInfo.deadline, v, r, s],
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
  const params: INonfungiblePositionManager.DecreaseLiquidityParamsStruct = {
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
        [params, feeBips],
      ),
    };
  }
  const { v, r, s } = splitSignature(permitInfo.signature);
  const functionFragment =
    'removeLiquidity((uint256,uint128,uint256,uint256,uint256),uint256,uint256,uint8,bytes32,bytes32)';
  return {
    functionFragment,
    data: IUniV3Automan__factory.createInterface().encodeFunctionData(
      functionFragment,
      [params, feeBips, permitInfo.deadline, v, r, s],
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
 * Simulate a `decreaseLiquidity` call.
 * @param chainId The chain ID.
 * @param provider A JSON RPC provider or a base provider.
 * @param from The address to simulate the call from.
 * @param owner The owner of the position to decrease liquidity from.
 * @param tokenId The token ID of the position to decrease liquidity from.
 * @param liquidity The amount of liquidity to decrease.
 * @param zeroForOne Whether to swap token0 for token1 or vice versa.
 * @param amountMin The minimum amount of token0 or token1 to receive.
 * @param feeBips The percentage of position value to pay as a fee, multiplied by 1e18.
 * @param swapData The swap data if using a router.
 * @param blockNumber Optional block number to query.
 */
export async function simulateDecreaseLiquiditySingle(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider | Provider,
  from: string,
  owner: string,
  tokenId: BigNumberish,
  liquidity: BigNumberish,
  zeroForOne: boolean,
  amountMin: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  swapData: BytesLike = '0x',
  blockNumber?: number,
): Promise<DecreaseLiquiditySingleReturnType> {
  const { functionFragment, data } = getAutomanDecreaseLiquiditySingleCallInfo(
    tokenId,
    liquidity,
    zeroForOne,
    Math.floor(Date.now() / 1000 + 86400),
    amountMin,
    feeBips,
    undefined,
    swapData,
  );
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionFragment,
    await tryStaticCallWithOverrides(
      from,
      getChainInfo(chainId).aperture_uniswap_v3_automan,
      data,
      getNPMApprovalOverrides(chainId, owner),
      provider,
      blockNumber,
    ),
  )[0] as DecreaseLiquiditySingleReturnType;
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
  const { aperture_uniswap_v3_automan } = getChainInfo(chainId);
  const tx = {
    from,
    to: aperture_uniswap_v3_automan,
    data,
  };
  let returnData: string;
  if (provider instanceof JsonRpcProvider) {
    // forge token approvals and balances
    const [token0Overrides, token1Overrides] = await Promise.all([
      getERC20Overrides(
        mintParams.token0,
        from,
        aperture_uniswap_v3_automan,
        mintParams.amount0Desired,
        provider,
      ),
      getERC20Overrides(
        mintParams.token1,
        from,
        aperture_uniswap_v3_automan,
        mintParams.amount1Desired,
        provider,
      ),
    ]);
    returnData = await staticCallWithOverrides(
      tx,
      {
        ...token0Overrides,
        ...token1Overrides,
      },
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
 * @param owner The owner of the position to burn.
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
  owner: string,
  tokenId: BigNumberish,
  amount0Min: BigNumberish = 0,
  amount1Min: BigNumberish = 0,
  feeBips: BigNumberish = 0,
  blockNumber?: number,
): Promise<RemoveLiquidityReturnType> {
  const { functionFragment, data } = getAutomanRemoveLiquidityCallInfo(
    tokenId,
    Math.floor(Date.now() / 1000 + 86400),
    amount0Min,
    amount1Min,
    feeBips,
  );
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionFragment,
    await tryStaticCallWithOverrides(
      from,
      getChainInfo(chainId).aperture_uniswap_v3_automan,
      data,
      getNPMApprovalOverrides(chainId, owner),
      provider,
      blockNumber,
    ),
  ) as RemoveLiquidityReturnType;
}

/**
 * Simulate a `rebalance` call.
 * @param chainId The chain ID.
 * @param provider A JSON RPC provider or a base provider.
 * @param from The address to simulate the call from.
 * @param owner The owner of the position to rebalance.
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
  owner: string,
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
  return IUniV3Automan__factory.createInterface().decodeFunctionResult(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    functionFragment,
    await tryStaticCallWithOverrides(
      from,
      getChainInfo(chainId).aperture_uniswap_v3_automan,
      data,
      getNPMApprovalOverrides(chainId, owner),
      provider,
      blockNumber,
    ),
  ) as RebalanceReturnType;
}
