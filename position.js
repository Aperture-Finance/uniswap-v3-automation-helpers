"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUniswapSDKPosition = exports.getUniswapSDKPositionFromBasicInfo = exports.getBasicPositionInfo = void 0;
const sdk_core_1 = require("@uniswap/sdk-core");
const v3_sdk_1 = require("@uniswap/v3-sdk");
const ethers_1 = require("ethers");
const multicall_1 = require("@0xsequence/multicall");
const chain_1 = require("./chain");
const typechain_types_1 = require("@aperture_finance/uniswap-v3-automation-sdk/typechain-types");
async function getBasicPositionInfo(chainId, positionId, provider) {
    const chainInfo = chain_1.CHAIN_ID_TO_INFO.get(chainId);
    const nonfungiblePositionManager = typechain_types_1.INonfungiblePositionManager__factory.connect(chainInfo.uniswap_v3_nonfungible_position_manager, provider);
    const positionInfo = await nonfungiblePositionManager.positions(positionId);
    const token0Address = positionInfo.token0;
    const token1Address = positionInfo.token1;
    const token0Contract = typechain_types_1.ERC20__factory.connect(token0Address, provider);
    const token1Contract = typechain_types_1.ERC20__factory.connect(token1Address, provider);
    const [token0Decimals, token1Decimals] = await Promise.all([
        token0Contract.decimals(),
        token1Contract.decimals(),
    ]);
    const token0 = new sdk_core_1.Token(chainId, token0Address, token0Decimals);
    const token1 = new sdk_core_1.Token(chainId, token1Address, token1Decimals);
    return {
        token0,
        token1,
        fee: positionInfo.fee,
        tickLower: positionInfo.tickLower,
        tickUpper: positionInfo.tickUpper,
        liquidity: positionInfo.liquidity.toString(),
        poolAddress: (0, v3_sdk_1.computePoolAddress)({
            factoryAddress: chainInfo.uniswap_v3_factory,
            tokenA: token0,
            tokenB: token1,
            fee: positionInfo.fee,
        }),
    };
}
exports.getBasicPositionInfo = getBasicPositionInfo;
async function getUniswapSDKPositionFromBasicInfo(basicInfo, provider) {
    const poolContract = typechain_types_1.IUniswapV3Pool__factory.connect(basicInfo.poolAddress, provider);
    const slot0 = await poolContract.slot0();
    return new v3_sdk_1.Position({
        pool: new v3_sdk_1.Pool(basicInfo.token0, basicInfo.token1, basicInfo.fee, slot0.sqrtPriceX96.toString(), basicInfo.liquidity, slot0.tick),
        liquidity: basicInfo.liquidity,
        tickLower: basicInfo.tickLower,
        tickUpper: basicInfo.tickUpper,
    });
}
exports.getUniswapSDKPositionFromBasicInfo = getUniswapSDKPositionFromBasicInfo;
async function getUniswapSDKPosition(chainId, positionId, provider) {
    // If `provider` is undefined, we use the public Infura node.
    if (provider === undefined) {
        provider = new multicall_1.providers.MulticallProvider(new ethers_1.ethers.providers.InfuraProvider(chain_1.CHAIN_ID_TO_INFO.get(chainId).infura_network_id));
    }
    return getUniswapSDKPositionFromBasicInfo(await getBasicPositionInfo(chainId, positionId, provider), provider);
}
exports.getUniswapSDKPosition = getUniswapSDKPosition;
