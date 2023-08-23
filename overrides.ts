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
            [
              owner,
              '0x0000000000000000000000000000000000000000000000000000000000000005',
            ],
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
          '0x0000000000000000000000000000000000000000000000000000000000000001',
      },
    },
  };
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
  if (
    token0BalanceOfAccessList.length !== 1 ||
    token0AllowanceAccessList.length !== 1 ||
    token1BalanceOfAccessList.length !== 1 ||
    token1AllowanceAccessList.length !== 1
  ) {
    throw new Error('Invalid access list length');
  }
  if (
    token0BalanceOfAccessList[0].storageKeys.length !== 1 ||
    token0AllowanceAccessList[0].storageKeys.length !== 1 ||
    token1BalanceOfAccessList[0].storageKeys.length !== 1 ||
    token1AllowanceAccessList[0].storageKeys.length !== 1
  ) {
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
        [token0BalanceOfAccessList[0].storageKeys[0]]: encodedAmount0Desired,
        [token0AllowanceAccessList[0].storageKeys[0]]: encodedAmount0Desired,
      },
    },
    [token1]: {
      stateDiff: {
        [token1BalanceOfAccessList[0].storageKeys[0]]: encodedAmount1Desired,
        [token1AllowanceAccessList[0].storageKeys[0]]: encodedAmount1Desired,
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
