import '@nomiclabs/hardhat-ethers';
import { config as dotenvConfig } from 'dotenv';
import 'hardhat-tracer';
import { HardhatUserConfig } from 'hardhat/config';

dotenvConfig();

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      chainId: 1,
    },
  },
};

export default config;
