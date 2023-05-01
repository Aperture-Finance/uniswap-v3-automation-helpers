"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAIN_ID_TO_INFO = exports.GOERLI_TESTNET_CHAIN_ID = exports.ARBITRUM_MAINNET_CHAIN_ID = exports.ETHEREUM_MAINNET_CHAIN_ID = void 0;
const utils_1 = require("ethers/lib/utils");
exports.ETHEREUM_MAINNET_CHAIN_ID = 1;
exports.ARBITRUM_MAINNET_CHAIN_ID = 42161;
exports.GOERLI_TESTNET_CHAIN_ID = 5;
exports.CHAIN_ID_TO_INFO = new Map([
    [
        exports.GOERLI_TESTNET_CHAIN_ID,
        {
            uniswap_v3_factory: (0, utils_1.getAddress)('0x1F98431c8aD98523631AE4a59f267346ea31F984'),
            uniswap_v3_nonfungible_position_manager: (0, utils_1.getAddress)('0xC36442b4a4522E871399CD717aBDD847Ab11FE88'),
            aperture_uniswap_v3_automan: (0, utils_1.getAddress)('0xE81df2Fc4f54D96e5f209e2D135f34E75725f34f'),
            infura_network_id: 'goerli',
        },
    ],
    [
        exports.ETHEREUM_MAINNET_CHAIN_ID,
        {
            uniswap_v3_factory: (0, utils_1.getAddress)('0x1F98431c8aD98523631AE4a59f267346ea31F984'),
            uniswap_v3_nonfungible_position_manager: (0, utils_1.getAddress)('0xC36442b4a4522E871399CD717aBDD847Ab11FE88'),
            // WARNING: This is a placeholder. Automan has not been deployed on the mainnet.
            aperture_uniswap_v3_automan: (0, utils_1.getAddress)('0xE81df2Fc4f54D96e5f209e2D135f34E75725f34f'),
            coingecko_asset_platform_id: 'ethereum',
            infura_network_id: 'mainnet',
        },
    ],
    [
        exports.ARBITRUM_MAINNET_CHAIN_ID,
        {
            uniswap_v3_factory: (0, utils_1.getAddress)('0x1F98431c8aD98523631AE4a59f267346ea31F984'),
            uniswap_v3_nonfungible_position_manager: (0, utils_1.getAddress)('0xC36442b4a4522E871399CD717aBDD847Ab11FE88'),
            // WARNING: This is a placeholder. Automan has not been deployed on Arbitrum mainnet.
            aperture_uniswap_v3_automan: (0, utils_1.getAddress)('0xE81df2Fc4f54D96e5f209e2D135f34E75725f34f'),
            coingecko_asset_platform_id: 'arbitrum-one',
            infura_network_id: 'arbitrum',
        },
    ],
]);
