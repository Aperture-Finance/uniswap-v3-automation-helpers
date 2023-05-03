import { Currency, CurrencyAmount, Percent, Price, Token } from "@uniswap/sdk-core";
import { FeeAmount, NonfungiblePositionManager, Pool, Position, computePoolAddress } from "@uniswap/v3-sdk";
import { UnsignedTransaction } from "ethers";
import { Provider } from '@ethersproject/abstract-provider';
import { alignPriceToClosestUsableTick } from "./tick";
import { CHAIN_ID_TO_INFO } from "./chain";
import { getNativeEther } from "./currency";
import { getPoolFromBasicPositionInfo } from "./pool";

/**
 * Generates an unsigned transaction that creates a position for the specified limit order.
 * The position has single-sided liquidity entirely concentrated on the input asset, and will
 * be closed by automation when the entire liquidity moves to the output asset.
 * Note that if the user wishes to sell ETH, then `limitPrice.baseCurrency` must be the WETH token,
 * but `inputCurrencyAmount.currency` should be either native ether or WETH token depending on which
 * the user chooses to provide.
 * Furthermore, `limitPrice` is expected to align to the closest usable tick already.
 * @param recipient The recipient address (connected wallet address).
 * @param limitPrice Limit price where the base currency is the input asset (what the user wants to sell) and the quote currency is the output asset (what the user wants to buy).
 * @param inputCurrencyAmount The amount of input asset that the user wants to sell.
 * @param poolFee The fee tier of the liquidity pool that the limit order position should be created on.
 * @param provider Ethers provider.
 * @returns The unsigned transaction that creates such a position.
 */
export async function getCreatePositionTxForLimitOrder(
    recipient: string,
    limitPrice: Price<Token, Token>,
    inputCurrencyAmount: CurrencyAmount<Currency>,
    poolFee: FeeAmount,
    provider: Provider
): Promise<UnsignedTransaction> {
    if (!alignPriceToClosestUsableTick(limitPrice, poolFee).equalTo(limitPrice)) {
        throw "Limit price not aligned";
    }
    const chainId = (await provider.getNetwork()).chainId;
    const basicPositionInfo = {
        token0: limitPrice.baseCurrency,
        token1: limitPrice.quoteCurrency,
        liquidity: "",  // TODO: fill this out properly.
        tickLower: 0,   // TODO: fill this out properly.
        tickUpper: 0,   // TODO: fill this out properly.
        fee: poolFee
    };
    const { calldata, value } = NonfungiblePositionManager.addCallParameters(
        new Position({
            pool: await getPoolFromBasicPositionInfo(basicPositionInfo, provider),
            tickLower: basicPositionInfo.tickLower,
            tickUpper: basicPositionInfo.tickUpper,
            liquidity: basicPositionInfo.liquidity
        }),
        {
            slippageTolerance: new Percent(0),
            deadline: "0",  // TODO: fill this out properly.
            useNative: inputCurrencyAmount.currency.isNative ? getNativeEther(chainId) : undefined,
            recipient,
        }
    );
    return {
        to: CHAIN_ID_TO_INFO.get(chainId)!.uniswap_v3_nonfungible_position_manager,
        data: calldata,
        value
    }
}
