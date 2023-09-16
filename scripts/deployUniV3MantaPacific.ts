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

// const chainId = 3441005;
const chainId = 169;
const provider = new JsonRpcProvider(
  // 'https://manta-testnet.calderachain.xyz/http',
  'https://pacific-rpc.manta.network/http',
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

/*
const NPM = '0x2dc114c0DEf2BC849996756E691FC6e8339649E1';
const USDC = '0x39471BEe1bBe79F3BFA774b6832D6a530edDaC6B';
const USDT = '0x6Cb54E76D7c739430A440A4b2dF97FC4a784EAdf';
const WBTC = '0x2ff78195D50fA975F9c08c8E24B55CD00C6fee43';
const WETH = '0xdB1fE098232A00A8B81dd6c2A911f2486cb374EE';
const TESTA = '0x50508D7CB6bF4e1664CE62E7cCECa96ca50B61C6';
const TESTB = '0x16Ab749236B326905be4195Fe01CBB260d944a1d';
*/
const NPM = '0xe77e3F98a386a4C8f8c706A2aCfFdf57e70D06c6';
const USDC = '0xb73603C5d87fA094B7314C74ACE2e64D165016fb';
const USDT = '0xf417F5A458eC102B90352F697D6e2Ac3A3d2851f';
const DAI = '0x1c466b9371f8aBA0D7c458bE10a62192Fcb8Aa71';
const WBTC = '0x305E88d809c9DC03179554BFbf85Ac05Ce8F18d6';
const rETH = '0x6E9655611b42C10b9aF25B6ca08bE349Df45c370';
const wstETH = '0x2FE3AD97a60EB7c79A976FC18Bb5fFD07Dd94BA5';
const WETH = '0x0Dc808adcE2099A9F62AA87D9670745AbA741746';

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
  await approveToken(DAI);
  await approveToken(rETH);
  await approveToken(wstETH);
  // await approveToken(WETH);
  // await approveToken(TESTA);
}

async function createUSDCUSDTPosition() {
  const usdcToken = new Token(chainId, USDC, 6);
  const usdtToken = new Token(chainId, USDT, 6);
  const pos = new Position({
    tickLower: -1,
    tickUpper: 1,
    liquidity: 2e10,
    pool: new Pool(usdcToken, usdtToken, FeeAmount.LOWEST, 2 ** 96, 0, 0),
  });
  // console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
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
  const pos = new Position({
    tickLower: -880000,
    tickUpper: 0,
    liquidity: 2.5e10,
    pool: new Pool(
      wethToken,
      usdcToken,
      FeeAmount.LOW,
      '3199281323841701057438220',
      0,
      -202354,
    ),
  });
  // console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
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
  const pos = new Position({
    tickLower: 0,
    tickUpper: 887220,
    liquidity: 1e5,
    pool: new Pool(
      wbtcToken,
      usdcToken,
      FeeAmount.MEDIUM,
      '1291413014252700387660522446835',
      0,
      55825,
    ),
  });
  // console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
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

async function createDAIUSDCPosition() {
  const usdcToken = new Token(chainId, USDC, 6);
  const daiToken = new Token(chainId, DAI, 18);
  const pos = new Position({
    tickLower: -276326,
    tickUpper: -276322,
    liquidity: 1e16,
    pool: new Pool(
      daiToken,
      usdcToken,
      FeeAmount.LOWEST,
      '79229949994420219835972',
      0,
      -276324,
    ),
  });
  // console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
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

async function createDAIUSDTPosition() {
  const usdtToken = new Token(chainId, USDT, 6);
  const daiToken = new Token(chainId, DAI, 18);
  const pos = new Position({
    tickLower: -276324,
    tickUpper: -276320,
    liquidity: 1e16,
    pool: new Pool(
      daiToken,
      usdtToken,
      FeeAmount.LOWEST,
      '79237863078951439443105',
      0,
      -276322,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
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

async function createWETHUSDTPosition() {
  const usdtToken = new Token(chainId, USDT, 6);
  const wethToken = new Token(chainId, WETH, 18);
  const pos = new Position({
    tickLower: -880000,
    tickUpper: 0,
    liquidity: 2.5e10,
    pool: new Pool(
      wethToken,
      usdtToken,
      FeeAmount.LOW,
      '3189294519216624458651003',
      0,
      -202416,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
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

async function createWETHDAIPosition() {
  const daiToken = new Token(chainId, DAI, 18);
  const wethToken = new Token(chainId, WETH, 18);
  const pos = new Position({
    tickLower: 0,
    tickUpper: 880000,
    liquidity: 3e16,
    pool: new Pool(
      wethToken,
      daiToken,
      FeeAmount.LOW,
      '3190326033718153150105991259857',
      0,
      73914,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
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

async function createWETHWBTC500Position() {
  const wbtcToken = new Token(chainId, WBTC, 8);
  const wethToken = new Token(chainId, WETH, 18);
  const pos = new Position({
    tickLower: -880000,
    tickUpper: 0,
    liquidity: 2e9,
    pool: new Pool(
      wethToken,
      wbtcToken,
      FeeAmount.LOW,
      '196467675734691782399042',
      0,
      -258160,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
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

async function createWETHWBTC3000Position() {
  const wbtcToken = new Token(chainId, WBTC, 8);
  const wethToken = new Token(chainId, WETH, 18);
  const pos = new Position({
    tickLower: -880020,
    tickUpper: 0,
    liquidity: 2e9,
    pool: new Pool(
      wethToken,
      wbtcToken,
      FeeAmount.MEDIUM,
      '196467675734691782399042',
      0,
      -258160,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
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

async function createWETHwstETHPosition() {
  const wstETHToken = new Token(chainId, wstETH, 18);
  const wethToken = new Token(chainId, WETH, 18);
  const pos = new Position({
    tickLower: -3000,
    tickUpper: -1300,
    liquidity: 1e17,
    pool: new Pool(
      wethToken,
      wstETHToken,
      FeeAmount.LOWEST,
      '74224817200515063638182526478',
      0,
      -1305,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
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

async function createwstETHWBTCPosition() {
  const wstETHToken = new Token(chainId, wstETH, 18);
  const wbtcToken = new Token(chainId, WBTC, 8);
  const pos = new Position({
    tickLower: -880000,
    tickUpper: 880000,
    liquidity: 1e9,
    pool: new Pool(
      wstETHToken,
      wbtcToken,
      FeeAmount.LOW,
      '209715856283711924154202',
      0,
      -256855,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
      slippageTolerance: new Percent(0),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      recipient: wallet.address,
      useNative: undefined,
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

async function createWETHrETHPosition() {
  const rETHToken = new Token(chainId, rETH, 18);
  const wethToken = new Token(chainId, WETH, 18);
  const pos = new Position({
    tickLower: -2000,
    tickUpper: -810,
    liquidity: 1e17,
    pool: new Pool(
      wethToken,
      rETHToken,
      FeeAmount.LOW,
      '76060864067760156629611866772',
      0,
      -816,
    ),
  });
  console.log(pos.amount0.toExact(), pos.amount1.toExact());
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    pos,
    {
      createPool: true,
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

/*
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
*/

().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
