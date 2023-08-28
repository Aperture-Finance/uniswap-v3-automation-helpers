import {
  ApertureSupportedChainId,
  IERC20__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider, TransactionRequest } from '@ethersproject/providers';
import { AccessList } from '@ethersproject/transactions';
import { BigNumberish } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';

import { getChainInfo } from './chain';

type StateOverrides = {
  [address: string]: {
    balance?: string;
    nonce?: string;
    code?: string;
    stateDiff?: {
      [slot: string]: string;
    };
  };
};

/**
 * Compute the storage slot for the operator approval in NonfungiblePositionManager.
 * @param owner The owner of the position.
 * @param spender The spender of the position.
 * @returns The storage slot.
 */
export function computeOperatorApprovalSlot(
  owner: string,
  spender: string,
): string {
  return keccak256(
    defaultAbiCoder.encode(
      ['address', 'bytes32'],
      [
        spender,
        keccak256(
          defaultAbiCoder.encode(
            ['address', 'bytes32'],
            [owner, defaultAbiCoder.encode(['uint256'], [5])],
          ),
        ),
      ],
    ),
  );
}

export function getNPMApprovalOverrides(
  chainId: ApertureSupportedChainId,
  owner: string,
): StateOverrides {
  const {
    aperture_uniswap_v3_automan,
    uniswap_v3_nonfungible_position_manager,
  } = getChainInfo(chainId);
  return {
    [uniswap_v3_nonfungible_position_manager]: {
      stateDiff: {
        [computeOperatorApprovalSlot(owner, aperture_uniswap_v3_automan)]:
          defaultAbiCoder.encode(['bool'], [true]),
      },
    },
  };
}

export function getAutomanWhitelistOverrides(
  chainId: ApertureSupportedChainId,
  routerToWhitelist: string,
): StateOverrides {
  return {
    [getChainInfo(chainId).aperture_uniswap_v3_automan]: {
      stateDiff: {
        [keccak256(
          defaultAbiCoder.encode(
            ['address', 'bytes32'],
            [routerToWhitelist, defaultAbiCoder.encode(['uint256'], [3])],
          ),
        )]: defaultAbiCoder.encode(['bool'], [true]),
      },
    },
  };
}

function symmetricalDifference<T>(arr1: T[], arr2: T[]): T[] {
  return [
    ...arr1.filter((item) => !arr2.includes(item)),
    ...arr2.filter((item) => !arr1.includes(item)),
  ];
}

export async function getTokenOverrides(
  chainId: ApertureSupportedChainId,
  provider: JsonRpcProvider,
  from: string,
  token0: string,
  token1: string,
  amount0Desired: BigNumberish,
  amount1Desired: BigNumberish,
): Promise<StateOverrides> {
  const iface = IERC20__factory.createInterface();
  const balanceOfData = iface.encodeFunctionData('balanceOf', [from]);
  const allowanceData = iface.encodeFunctionData('allowance', [
    from,
    getChainInfo(chainId).aperture_uniswap_v3_automan,
  ]);
  const [
    token0BalanceOfAccessList,
    token0AllowanceAccessList,
    token1BalanceOfAccessList,
    token1AllowanceAccessList,
  ] = await Promise.all([
    generateAccessList(
      {
        from,
        to: token0,
        data: balanceOfData,
      },
      provider,
    ),
    generateAccessList(
      {
        from,
        to: token0,
        data: allowanceData,
      },
      provider,
    ),
    generateAccessList(
      {
        from,
        to: token1,
        data: balanceOfData,
      },
      provider,
    ),
    generateAccessList(
      {
        from,
        to: token1,
        data: allowanceData,
      },
      provider,
    ),
  ]);
  // tokens on L2 and those with a proxy will have more than one access list entry
  const filteredToken0BalanceOfAccessList = token0BalanceOfAccessList.filter(
    ({ address }) => address.toLowerCase() === token0.toLowerCase(),
  );
  const filteredToken0AllowanceAccessList = token0AllowanceAccessList.filter(
    ({ address }) => address.toLowerCase() === token0.toLowerCase(),
  );
  const filteredToken1BalanceOfAccessList = token1BalanceOfAccessList.filter(
    ({ address }) => address.toLowerCase() === token1.toLowerCase(),
  );
  const filteredToken1AllowanceAccessList = token1AllowanceAccessList.filter(
    ({ address }) => address.toLowerCase() === token1.toLowerCase(),
  );
  if (
    filteredToken0BalanceOfAccessList.length !== 1 ||
    filteredToken0AllowanceAccessList.length !== 1 ||
    filteredToken1BalanceOfAccessList.length !== 1 ||
    filteredToken1AllowanceAccessList.length !== 1
  ) {
    throw new Error('Invalid access list length');
  }
  // get rid of the storage key of implementation address
  const token0StorageKeys = symmetricalDifference(
    filteredToken0BalanceOfAccessList[0].storageKeys,
    filteredToken0AllowanceAccessList[0].storageKeys,
  );
  const token1StorageKeys = symmetricalDifference(
    filteredToken1BalanceOfAccessList[0].storageKeys,
    filteredToken1AllowanceAccessList[0].storageKeys,
  );
  if (token0StorageKeys.length !== 2 || token1StorageKeys.length !== 2) {
    throw new Error('Invalid storage key number');
  }
  const encodedAmount0Desired = defaultAbiCoder.encode(
    ['uint256'],
    [amount0Desired],
  );
  const encodedAmount1Desired = defaultAbiCoder.encode(
    ['uint256'],
    [amount1Desired],
  );
  // TODO: handle native ETH edge case
  return {
    [token0]: {
      stateDiff: {
        [token0StorageKeys[0]]: encodedAmount0Desired,
        [token0StorageKeys[1]]: encodedAmount0Desired,
      },
    },
    [token1]: {
      stateDiff: {
        [token1StorageKeys[0]]: encodedAmount1Desired,
        [token1StorageKeys[1]]: encodedAmount1Desired,
      },
    },
  };
}

export async function generateAccessList(
  tx: TransactionRequest,
  provider: JsonRpcProvider,
  blockNumber?: number,
): Promise<AccessList> {
  try {
    const { accessList } = await provider.send('eth_createAccessList', [
      {
        ...tx,
        gas: '0x11E1A300',
        gasPrice: '0x0',
      },
      // hexlify the block number.
      blockNumber ? '0x' + blockNumber.toString(16) : 'latest',
    ]);
    return accessList as AccessList;
  } catch (error) {
    console.error('Error generating access list:', error);
    throw error;
  }
}

export async function staticCallWithOverrides(
  tx: TransactionRequest,
  overrides: StateOverrides,
  provider: JsonRpcProvider,
  blockNumber?: number,
): Promise<string> {
  return await provider.send('eth_call', [
    tx,
    // hexlify the block number.
    blockNumber ? '0x' + blockNumber.toString(16) : 'latest',
    overrides,
  ]);
}
