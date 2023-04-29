import '@nomiclabs/hardhat-ethers';
import { HardhatUserConfig } from 'hardhat/config';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      chainId: 1,
      forking: {
        url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
        blockNumber: 17030467,
      },
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
  },
};

export default config;
