import { JsonRpcProvider } from '@ethersproject/providers';
import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json';
import { Contract, ContractFactory } from 'ethers';
import { ethers } from 'hardhat';

const wallet = ethers.Wallet.fromMnemonic(
  'carry popular copper pink result debate february sword bounce upper island hip whale weird pink regular marble law lottery december buzz work slush jaguar',
).connect(new JsonRpcProvider('https://manta-testnet.calderachain.xyz/http'));

async function main() {
  const univ3Factory = new ContractFactory(
    FACTORY_ABI,
    FACTORY_BYTECODE,
  ).connect(wallet);
  const factoryContract = await univ3Factory.deploy();
  await factoryContract.deployed();
}

async function createPool() {
  const factory = new Contract(
    '0xFAA645e38aF8a03aC52dEABE309AED13aB26f6B6',
    FACTORY_ABI,
  ).connect(wallet);
  /*
    ethers.Wallet.fromMnemonic(
      'duck quiz hurt cram april indoor other beach eight month rose ordinary reject inform economy artefact brain attend avocado grief yellow manual video tomato',
    ).connect(
      new JsonRpcProvider('https://manta-testnet.calderachain.xyz/http'),
    ),
  );*/
  await factory.createPool(
    '0x5A7D7c68712d34f0771DB1351489C3Dfd8e2b9bf',
    '0x5572C7D0de16D2C3E830331c845a285b5Fc71e10',
    10000,
  );
  /*
  console.log(
    await factory.getPool(
      '0x5A7D7c68712d34f0771DB1351489C3Dfd8e2b9bf',
      '0x5572C7D0de16D2C3E830331c845a285b5Fc71e10',
      10000,
    ),
  );*/
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
createPool().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
