import '@nomiclabs/hardhat-ethers';
import { config as dotenvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotenvConfig();

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: `${process.env.MAINNET_RPC_URL}`,
        blockNumber: 17188000,
      },
    },
    goerli: {
      url: `${process.env.GOERLI_RPC_URL}`,
    },
  },
};

export default config;
