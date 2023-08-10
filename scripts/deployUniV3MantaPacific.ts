import { IERC20__factory } from '@aperture_finance/uniswap-v3-automation-sdk';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Percent, Token } from '@uniswap/sdk-core';
import { Ether, NativeCurrency } from '@uniswap/sdk-core';
import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json';
import {
  FeeAmount,
  NonfungiblePositionManager,
  Pool,
  Position,
} from '@uniswap/v3-sdk';
import { config as dotenvConfig } from 'dotenv';
import { Contract, ContractFactory, ethers } from 'ethers';

dotenvConfig();

const chainId = 3441005;
const provider = new JsonRpcProvider(
  'https://manta-testnet.calderachain.xyz/http',
);
const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);

async function deployFactory() {
  const univ3Factory = new ContractFactory(
    FACTORY_ABI,
    FACTORY_BYTECODE,
  ).connect(wallet);
  const factoryContract = await univ3Factory.deploy();
  await factoryContract.deployed();
}

const NPM = '0x2dc114c0DEf2BC849996756E691FC6e8339649E1';
const USDC = '0x39471BEe1bBe79F3BFA774b6832D6a530edDaC6B';
const USDT = '0x6Cb54E76D7c739430A440A4b2dF97FC4a784EAdf';
const WBTC = '0x2ff78195D50fA975F9c08c8E24B55CD00C6fee43';
const WETH = '0xdB1fE098232A00A8B81dd6c2A911f2486cb374EE';
const TESTA = '0x50508D7CB6bF4e1664CE62E7cCECa96ca50B61C6';
const TESTB = '0x16Ab749236B326905be4195Fe01CBB260d944a1d';

async function approveToken(tokenAddress: string) {
  const tokenContract = new Contract(tokenAddress, IERC20__factory.abi).connect(
    wallet,
  );
  const txResponse = await tokenContract.approve(NPM, '0xffffffffffffffff');
  const txReceipt = await provider.waitForTransaction(txResponse.hash);
  console.log(`tx completed: ${txReceipt.transactionHash}.`);
}

async function approveTokens() {
  await approveToken(USDC);
  await approveToken(USDT);
  await approveToken(WBTC);
  await approveToken(WETH);
  await approveToken(TESTA);
}

async function createUSDCUSDTPosition() {
  const usdcToken = new Token(chainId, USDC, 6);
  const usdtToken = new Token(chainId, USDT, 6);
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    new Position({
      tickLower: -10,
      tickUpper: 10,
      liquidity: 1e13,
      pool: new Pool(usdcToken, usdtToken, FeeAmount.LOW, 2 ** 96, 0, 0),
    }),
    {
      createPool: false,
      slippageTolerance: new Percent(0),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      recipient: wallet.address,
    },
  );
  const txResponse = await wallet.sendTransaction({
    to: NPM,
    data: calldata,
    value,
  });
  const txReceipt = await provider.waitForTransaction(txResponse.hash);
  console.log(`tx completed: ${txReceipt.transactionHash}.`);
}

class MantaEther extends Ether {
  public get wrapped(): Token {
    return new Token(chainId, WETH, 18);
  }
  private static _cachedExtendedEther: { [chainId: number]: NativeCurrency } =
    {};

  public static onChain(chainId: number): MantaEther {
    return (
      this._cachedExtendedEther[chainId] ??
      (this._cachedExtendedEther[chainId] = new MantaEther(chainId))
    );
  }
}

async function createWETHUSDCPosition() {
  const usdcToken = new Token(chainId, USDC, 6);
  const wethToken = new Token(chainId, WETH, 18);
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    new Position({
      tickLower: 199980,
      tickUpper: 203340,
      liquidity: 1e14,
      pool: new Pool(
        usdcToken,
        wethToken,
        FeeAmount.MEDIUM,
        '1850262202266990725608260239488933',
        0,
        201180,
      ),
    }),
    {
      createPool: false,
      slippageTolerance: new Percent(0),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      recipient: wallet.address,
      useNative: MantaEther.onChain(chainId),
    },
  );
  const txResponse = await wallet.sendTransaction({
    to: NPM,
    data: calldata,
    value,
  });
  const txReceipt = await provider.waitForTransaction(txResponse.hash);
  console.log(`tx completed: ${txReceipt.transactionHash}.`);
}

async function createWBTCUSDCPosition() {
  const usdcToken = new Token(chainId, USDC, 6);
  const wbtcToken = new Token(chainId, WBTC, 8);
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    new Position({
      tickLower: 54000,
      tickUpper: 60000,
      liquidity: 1e14,
      pool: new Pool(
        usdcToken,
        wbtcToken,
        FeeAmount.MEDIUM,
        '1349496664126056159568007774504',
        0,
        56705,
      ),
    }),
    {
      createPool: true,
      slippageTolerance: new Percent(0),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      recipient: wallet.address,
    },
  );
  const txResponse = await wallet.sendTransaction({
    to: NPM,
    data: calldata,
    value,
  });
  const txReceipt = await provider.waitForTransaction(txResponse.hash);
  console.log(`tx completed: ${txReceipt.transactionHash}.`);
}

async function createWBTCTESTAPosition() {
  const testaToken = new Token(chainId, TESTA, 8);
  const wbtcToken = new Token(chainId, WBTC, 8);
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    new Position({
      tickLower: -100,
      tickUpper: 100,
      liquidity: 1e12,
      pool: new Pool(testaToken, wbtcToken, FeeAmount.LOWEST, 2 ** 96, 0, 0),
    }),
    {
      createPool: true,
      slippageTolerance: new Percent(0),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      recipient: wallet.address,
    },
  );
  const txResponse = await wallet.sendTransaction({
    to: NPM,
    data: calldata,
    value,
  });
  const txReceipt = await provider.waitForTransaction(txResponse.hash);
  console.log(`tx completed: ${txReceipt.transactionHash}.`);
}

async function createTESTAUSDTPosition() {
  const testaToken = new Token(chainId, TESTA, 8);
  const usdtToken = new Token(chainId, USDT, 6);
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    new Position({
      tickLower: 54000,
      tickUpper: 60000,
      liquidity: 1e14,
      pool: new Pool(
        testaToken,
        usdtToken,
        FeeAmount.MEDIUM,
        '1349496664126056159568007774504',
        0,
        56705,
      ),
    }),
    {
      createPool: true,
      slippageTolerance: new Percent(0),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      recipient: wallet.address,
    },
  );
  const txResponse = await wallet.sendTransaction({
    to: NPM,
    data: calldata,
    value,
  });
  const txReceipt = await provider.waitForTransaction(txResponse.hash);
  console.log(`tx completed: ${txReceipt.transactionHash}.`);
}

async function createTESTATESTBPosition() {
  await approveToken(TESTB);
  const testaToken = new Token(chainId, TESTA, 8);
  const testbToken = new Token(chainId, TESTB, 8);
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    new Position({
      tickLower: -100,
      tickUpper: 100,
      liquidity: 1e14,
      pool: new Pool(testaToken, testbToken, FeeAmount.LOWEST, 2 ** 96, 0, 0),
    }),
    {
      createPool: true,
      slippageTolerance: new Percent(0),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      recipient: wallet.address,
    },
  );
  const txResponse = await wallet.sendTransaction({
    to: NPM,
    data: calldata,
    value,
  });
  const txReceipt = await provider.waitForTransaction(txResponse.hash);
  console.log(`tx completed: ${txReceipt.transactionHash}.`);
}

createTESTATESTBPosition().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
