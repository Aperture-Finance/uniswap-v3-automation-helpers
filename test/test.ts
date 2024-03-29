import { providers } from '@0xsequence/multicall';
import {
  ActionTypeEnum,
  ApertureSupportedChainId,
  ConditionTypeEnum,
  DOUBLE_TICK,
  IERC20__factory,
  OptimalSwapRouter__factory,
  PriceConditionSchema,
  Q192,
  UniV3Automan,
  UniV3Automan__factory,
  WETH__factory,
  alignPriceToClosestUsableTick,
  fractionToBig,
  getChainInfo,
  getRawRelativePriceFromTokenValueProportion,
  getTokenValueProportionFromPriceRatio,
  parsePrice,
  priceToClosestTickSafe,
  priceToClosestUsableTick,
  tickToLimitOrderRange,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { reset as hardhatReset } from '@nomicfoundation/hardhat-network-helpers';
import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core';
import {
  FeeAmount,
  Pool,
  Position,
  TICK_SPACINGS,
  TickMath,
  nearestUsableTick,
  priceToClosestTick,
  tickToPrice,
} from '@uniswap/v3-sdk';
import Big from 'big.js';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber, BigNumberish, Signer } from 'ethers';
import { defaultAbiCoder, getAddress } from 'ethers/lib/utils';
import hre, { ethers } from 'hardhat';
import JSBI from 'jsbi';

import { optimalMint, optimalRebalance, optimalZapOut } from '../aggregator';
import { getAutomanReinvestCallInfo, simulateMintOptimal } from '../automan';
import {
  checkTokenLiquidityAgainstChainNativeCurrency,
  getCurrencyAmount,
  getNativeCurrency,
  getToken,
} from '../currency';
import {
  computeOperatorApprovalSlot,
  generateAccessList,
  getERC20Overrides,
} from '../overrides';
import {
  generateAutoCompoundRequestPayload,
  generateLimitOrderCloseRequestPayload,
  generatePriceConditionFromTokenValueProportion,
} from '../payload';
import {
  checkPositionApprovalStatus,
  generateTypedDataForPermit,
} from '../permission';
import {
  checkAutomationSupportForPool,
  getFeeTierDistribution,
  getLiquidityArrayForPool,
  getPool,
  getTickToLiquidityMapForPool,
} from '../pool';
import {
  BasicPositionInfo,
  PositionDetails,
  getAllPositionBasicInfoByOwner,
  getAllPositionsDetails,
  getBasicPositionInfo,
  getCollectableTokenAmounts,
  getNPM,
  getPosition,
  getPositionAtPrice,
  getPositionFromBasicInfo,
  getRebalancedPosition,
  getReinvestedPosition,
  getTokenSvg,
  isPositionInRange,
  projectRebalancedPositionAtPrice,
  viewCollectableTokenAmounts,
} from '../position';
import {
  estimateTotalGasCostForOptimismLikeL2Tx,
  getPublicProvider,
} from '../provider';
import {
  fetchQuoteFromRoutingApi,
  fetchQuoteFromSpecifiedRoutingApiInfo,
} from '../routing';
import {
  getAddLiquidityTx,
  getCollectTx,
  getCollectedFeesFromReceipt,
  getCreatePositionTx,
  getCreatePositionTxForLimitOrder,
  getMintedPositionIdFromTxReceipt,
  getOptimalMintTx,
  getRebalanceTx,
  getReinvestTx,
  getRemoveLiquidityTx,
  getUnwrapETHTx,
  getWrapETHTx,
  getZapOutTx,
} from '../transaction';
import { getPoolsFromSubgraph, getWhitelistedPools } from '../whitelist';

chai.use(chaiAsPromised);
const expect = chai.expect;
// The hardhat fork provider uses `eth_getStorageAt` instead of `eth_call` so there is no benefit of using the `MulticallProvider`.
const hardhatForkProvider = ethers.provider;
const chainId = ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID;
// A whale address (Avax bridge) on Ethereum mainnet with a lot of ethers and token balances.
const WHALE_ADDRESS = '0x8EB8a3b98659Cce290402893d0123abb75E3ab28';
const WBTC_ADDRESS = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
// Owner of position id 4 on Ethereum mainnet.
const eoa = '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF';
// A fixed epoch second value representing a moment in the year 2099.
const deadline = '4093484400';

// Test wallet so we can test signing permit messages.
// Public key: 0x035dcbb4b39244cef94d3263074f358a1d789e6b99f278d5911f9694da54312636
// Address: 0x1ccaCD01fD2d973e134EC6d4F916b90A45634eCe
const TEST_WALLET_PRIVATE_KEY =
  '0x077646fb889571f9ce30e420c155812277271d4d914c799eef764f5709cafd5b';

async function resetHardhatNetwork() {
  await hardhatReset(
    `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
    /*blockNumber=*/ 17188000,
  );
}

describe('Limit order tests', function () {
  let WBTC: Token, WETH: Token;
  const poolFee = FeeAmount.MEDIUM;

  before(async function () {
    await resetHardhatNetwork();
    WBTC = await getToken(WBTC_ADDRESS, chainId, hardhatForkProvider);
    WETH = await getToken(WETH_ADDRESS, chainId, hardhatForkProvider);
  });

  it('Selling WBTC for WETH', async function () {
    const price = parsePrice(WBTC, WETH, '10.234');
    expect(price.toFixed(6)).to.equal('10.234000');
    const tenWBTC = getCurrencyAmount(WBTC, '10.0');
    expect(price.quote(tenWBTC as CurrencyAmount<Token>).toExact()).to.equal(
      '102.34',
    );
    const alignedPrice = alignPriceToClosestUsableTick(price, poolFee);
    expect(alignedPrice.toFixed(9)).to.equal('10.205039374');
    await expect(
      getCreatePositionTxForLimitOrder(
        eoa,
        alignedPrice,
        tenWBTC,
        poolFee,
        deadline,
        chainId,
        hardhatForkProvider,
      ),
    ).to.be.rejectedWith('Specified limit price not applicable');

    const pool = await getPool(
      WETH,
      WBTC,
      poolFee,
      chainId,
      hardhatForkProvider,
    );
    const currentPrice = tickToPrice(
      pool.token0,
      pool.token1,
      pool.tickCurrent,
    );
    expect(currentPrice.toFixed(6)).to.be.equal('15.295542'); // 1 WBTC = 15.295542 WETH.
    const alignedLimitPrice = alignPriceToClosestUsableTick(
      parsePrice(WBTC, WETH, '16.16'),
      poolFee,
    );
    expect(alignedLimitPrice.toFixed(6)).to.be.equal('16.197527');
    const tx = await getCreatePositionTxForLimitOrder(
      eoa,
      alignedLimitPrice,
      tenWBTC,
      poolFee,
      deadline,
      chainId,
      hardhatForkProvider,
    );
    const npmAddress =
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager;
    expect(tx).to.deep.equal({
      to: npmAddress,
      data: '0x883164560000000000000000000000002260fac5e5542a773aa44fbcfedf7c193bc2c599000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000003f048000000000000000000000000000000000000000000000000000000000003f084000000000000000000000000000000000000000000000000000000003b9aca000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004bd047ca72fa05f0b89ad08fe5ba5ccdc07dffbf00000000000000000000000000000000000000000000000000000000f3fd9d70',
      value: '0x00',
    });
    // Top up 10 WBTC to `eoa` from `impersonatedWhale`.
    const impersonatedWhale = await ethers.getImpersonatedSigner(WHALE_ADDRESS);
    await IERC20__factory.connect(WBTC.address, impersonatedWhale).transfer(
      eoa,
      tenWBTC.quotient.toString(),
    );
    const impersonatedEOA = await ethers.getImpersonatedSigner(eoa);
    await IERC20__factory.connect(WBTC.address, impersonatedEOA).approve(
      npmAddress,
      tenWBTC.quotient.toString(),
    );
    // Create the limit order position.
    const txReceipt = await (await impersonatedEOA.sendTransaction(tx)).wait();
    const positionId = getMintedPositionIdFromTxReceipt(
      chainId,
      txReceipt,
      eoa,
    )!;
    const basicPositionInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    const { tickLower, tickUpper } = tickToLimitOrderRange(
      priceToClosestTickSafe(alignedLimitPrice),
      poolFee,
    );
    expect(basicPositionInfo).to.deep.equal({
      token0: WBTC,
      token1: WETH,
      liquidity: '134361875488133608',
      tickLower,
      tickUpper,
      fee: poolFee,
    });
    const position = await getPositionFromBasicInfo(
      basicPositionInfo,
      chainId,
      hardhatForkProvider,
    );
    // The user actually provided 9.99999999 WBTC due to liquidity precision, i.e. 10 WBTC would have yielded the exact same liquidity amount of 134361875488133608.
    expect(position.amount0.quotient.toString()).to.equal('999999999');
    expect(position.amount1.quotient.toString()).to.equal('0');
    expect(
      generateLimitOrderCloseRequestPayload(
        eoa,
        chainId,
        positionId,
        alignedLimitPrice,
        /*maxGasProportion=*/ 0.2,
        /*expiration=*/ 1627776000,
      ),
    ).to.deep.equal({
      action: {
        inputTokenAddr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        maxGasProportion: 0.2,
        type: 'LimitOrderClose',
      },
      chainId: 1,
      condition: {
        type: 'TokenAmount',
        zeroAmountToken: 0,
      },
      nftId: '500511',
      ownerAddr: '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF',
      expiration: 1627776000,
    });
  });

  it('Selling WETH for WBTC', async function () {
    const tenWETH = getCurrencyAmount(WETH, '10');

    // The current price is 1 WBTC = 15.295542 WETH. Trying to sell WETH at 1 WETH = 1/18 WBTC is lower than the current price and therefore should be rejected.
    await expect(
      getCreatePositionTxForLimitOrder(
        eoa,
        alignPriceToClosestUsableTick(
          parsePrice(WBTC, WETH, '18').invert(),
          poolFee,
        ),
        tenWETH,
        poolFee,
        deadline,
        chainId,
        hardhatForkProvider,
      ),
    ).to.be.rejectedWith('Specified limit price not applicable');

    const alignedLimitPrice = alignPriceToClosestUsableTick(
      parsePrice(WBTC, WETH, '12.12').invert(),
      poolFee,
    );
    expect(alignedLimitPrice.toFixed(6)).to.be.equal('0.082342');
    const tx = await getCreatePositionTxForLimitOrder(
      eoa,
      alignedLimitPrice,
      tenWETH,
      poolFee,
      deadline,
      chainId,
      hardhatForkProvider,
    );
    const npmAddress =
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager;
    expect(tx).to.deep.equal({
      to: npmAddress,
      data: '0x883164560000000000000000000000002260fac5e5542a773aa44fbcfedf7c193bc2c599000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000003e508000000000000000000000000000000000000000000000000000000000003e54400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008ac7230489e7fe5900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008ac7230489e7fe590000000000000000000000004bd047ca72fa05f0b89ad08fe5ba5ccdc07dffbf00000000000000000000000000000000000000000000000000000000f3fd9d70',
      value: '0x00',
    });
    // Top up 10 WETH to `eoa` from `impersonatedWhale`.
    const impersonatedWhale = await ethers.getImpersonatedSigner(WHALE_ADDRESS);
    await IERC20__factory.connect(WETH.address, impersonatedWhale).transfer(
      eoa,
      tenWETH.quotient.toString(),
    );
    const impersonatedEOA = await ethers.getImpersonatedSigner(eoa);
    await IERC20__factory.connect(WETH.address, impersonatedEOA).approve(
      npmAddress,
      tenWETH.quotient.toString(),
    );
    // Create the limit order position.
    const txReceipt = await (await impersonatedEOA.sendTransaction(tx)).wait();
    const positionId = getMintedPositionIdFromTxReceipt(
      chainId,
      txReceipt,
      eoa,
    )!;
    const basicPositionInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    expect(basicPositionInfo).to.deep.equal({
      token0: WBTC,
      token1: WETH,
      liquidity: '9551241229311572',
      tickLower: priceToClosestTick(alignedLimitPrice),
      tickUpper: priceToClosestTick(alignedLimitPrice) + TICK_SPACINGS[poolFee],
      fee: poolFee,
    });
    const position = await getPositionFromBasicInfo(
      basicPositionInfo,
      chainId,
      hardhatForkProvider,
    );
    // The user actually provided 9.999999999999999576 WETH due to liquidity precision, i.e. 10 WETH would have yielded the exact same liquidity amount of 9551241229311572.
    expect(position.amount0.quotient.toString()).to.equal('0');
    expect(position.amount1.quotient.toString()).to.equal(
      '9999999999999999576',
    );
    expect(
      generateLimitOrderCloseRequestPayload(
        eoa,
        chainId,
        positionId,
        alignedLimitPrice,
        /*maxGasProportion=*/ 0.2,
        /*expiration=*/ 1627776000,
      ),
    ).to.deep.equal({
      action: {
        inputTokenAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        maxGasProportion: 0.2,
        type: 'LimitOrderClose',
      },
      chainId: 1,
      condition: {
        type: 'TokenAmount',
        zeroAmountToken: 1,
      },
      nftId: '500512',
      ownerAddr: '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF',
      expiration: 1627776000,
    });

    // Create another WETH -> WBTC limit order but provide native ether this time.
    const tenETH = getCurrencyAmount(getNativeCurrency(chainId), '10');
    const nativeEthTx = await getCreatePositionTxForLimitOrder(
      eoa,
      alignedLimitPrice,
      tenETH,
      poolFee,
      deadline,
      chainId,
      hardhatForkProvider,
    );
    expect(nativeEthTx).to.deep.equal({
      to: npmAddress,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000164883164560000000000000000000000002260fac5e5542a773aa44fbcfedf7c193bc2c599000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000003e508000000000000000000000000000000000000000000000000000000000003e54400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008ac7230489e7fe5900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008ac7230489e7fe590000000000000000000000004bd047ca72fa05f0b89ad08fe5ba5ccdc07dffbf00000000000000000000000000000000000000000000000000000000f3fd9d7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000412210e8a00000000000000000000000000000000000000000000000000000000',
      value: '0x8ac7230489e7fe59',
    });
    const nativeEthTxReceipt = await (
      await impersonatedEOA.sendTransaction(nativeEthTx)
    ).wait();
    const nativeEthPositionId = getMintedPositionIdFromTxReceipt(
      chainId,
      nativeEthTxReceipt,
      eoa,
    )!;
    expect(
      await getBasicPositionInfo(
        chainId,
        nativeEthPositionId,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      token0: WBTC,
      token1: WETH,
      liquidity: '9551241229311572',
      tickLower: priceToClosestTick(alignedLimitPrice),
      tickUpper: priceToClosestTick(alignedLimitPrice) + TICK_SPACINGS[poolFee],
      fee: poolFee,
    });
    expect(
      generateLimitOrderCloseRequestPayload(
        eoa,
        chainId,
        nativeEthPositionId,
        alignedLimitPrice,
        /*maxGasProportion=*/ 0.2,
        /*expiration=*/ 1627776000,
      ),
    ).to.deep.equal({
      action: {
        inputTokenAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        maxGasProportion: 0.2,
        type: 'LimitOrderClose',
      },
      chainId: 1,
      condition: {
        type: 'TokenAmount',
        zeroAmountToken: 1,
      },
      nftId: '500513',
      ownerAddr: '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF',
      expiration: 1627776000,
    });
  });
});

describe('Position liquidity management tests', function () {
  const positionId = 4;
  let WBTC: Token, WETH: Token;
  const wbtcContract = IERC20__factory.connect(
    WBTC_ADDRESS,
    hardhatForkProvider,
  );
  const wethContract = IERC20__factory.connect(
    WETH_ADDRESS,
    hardhatForkProvider,
  );
  let wbtcBalanceBefore: BigNumber,
    wethBalanceBefore: BigNumber,
    nativeEtherBalanceBefore: BigNumber;
  let position4BasicInfo: BasicPositionInfo;
  let position4ColletableTokenAmounts: {
    token0Amount: CurrencyAmount<Token>;
    token1Amount: CurrencyAmount<Token>;
  };

  before(async function () {
    await resetHardhatNetwork();
    wbtcBalanceBefore = await wbtcContract.balanceOf(eoa);
    wethBalanceBefore = await wethContract.balanceOf(eoa);
    nativeEtherBalanceBefore = await hardhatForkProvider.getBalance(eoa);
    position4BasicInfo = await getBasicPositionInfo(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    position4ColletableTokenAmounts = await getCollectableTokenAmounts(
      chainId,
      positionId,
      hardhatForkProvider,
      position4BasicInfo,
    );

    WBTC = await getToken(WBTC_ADDRESS, chainId, hardhatForkProvider);
    WETH = await getToken(WETH_ADDRESS, chainId, hardhatForkProvider);
  });

  beforeEach(async function () {
    await resetHardhatNetwork();
  });

  it('Collect fees', async function () {
    const txRequest = await getCollectTx(
      positionId,
      eoa,
      chainId,
      hardhatForkProvider,
      false,
      position4BasicInfo,
    );
    const eoaSigner = await ethers.getImpersonatedSigner(eoa);
    const txReceipt = await (await eoaSigner.sendTransaction(txRequest)).wait();
    const collectedFees = getCollectedFeesFromReceipt(
      txReceipt,
      position4BasicInfo.token0,
      position4BasicInfo.token1,
    );
    expect(collectedFees).deep.equal(position4ColletableTokenAmounts);
    expect(
      (await wbtcContract.balanceOf(eoa)).eq(
        wbtcBalanceBefore.add(
          position4ColletableTokenAmounts.token0Amount.quotient.toString(),
        ),
      ),
    ).to.equal(true);
    expect(
      (await wethContract.balanceOf(eoa)).eq(
        wethBalanceBefore.add(
          position4ColletableTokenAmounts.token1Amount.quotient.toString(),
        ),
      ),
    ).to.equal(true);
  });

  it('Decrease liquidity (receive native ether + WBTC), increase liquidity, and create position', async function () {
    // ------- Decrease Liquidity -------
    // Decrease liquidity from position id 4.
    const position = await getPositionFromBasicInfo(
      position4BasicInfo,
      chainId,
      hardhatForkProvider,
    );
    const liquidityPercentage = new Percent(1); // 100%
    const removeLiquidityTxRequest = await getRemoveLiquidityTx(
      {
        tokenId: positionId,
        liquidityPercentage,
        slippageTolerance: new Percent(0),
        deadline: Math.floor(Date.now() / 1000),
      },
      eoa,
      chainId,
      hardhatForkProvider,
      /*receiveNativeEtherIfApplicable=*/ true,
      position,
    );
    const eoaSigner = await ethers.getImpersonatedSigner(eoa);
    const removeLiquidityTxReceipt = await (
      await eoaSigner.sendTransaction(removeLiquidityTxRequest)
    ).wait();
    const collectedFees = getCollectedFeesFromReceipt(
      removeLiquidityTxReceipt,
      position4BasicInfo.token0,
      position4BasicInfo.token1,
    );
    expect(collectedFees).deep.equal(position4ColletableTokenAmounts);
    expect(
      (await wbtcContract.balanceOf(eoa)).eq(
        wbtcBalanceBefore
          // Add collected WBTC fees.
          .add(position4ColletableTokenAmounts.token0Amount.quotient.toString())
          // Add withdrawn WBTC liquidity.
          .add(position.amount0.quotient.toString()),
      ),
    ).to.equal(true);
    expect(
      (await hardhatForkProvider.getBalance(eoa)).eq(
        nativeEtherBalanceBefore
          // Add collected WETH fees.
          .add(position4ColletableTokenAmounts.token1Amount.quotient.toString())
          // Add withdrawn WETH liquidity.
          .add(position.amount1.quotient.toString())
          // Subtract gas paid in ETH.
          .sub(
            removeLiquidityTxReceipt.gasUsed.mul(
              removeLiquidityTxReceipt.effectiveGasPrice,
            ),
          ),
      ),
    ).to.equal(true);

    // ------- Add Liquidity -------
    // We now start to add some liquidity to position id 4.
    // This involves three steps:
    // (1) Figure out the amount of liquidity that can be minted with the provided amounts of the two tokens.
    // (2) Approve the two tokens for Uniswap NPM contract to spend, if necessary.
    // (3) Send out the tx that adds liquidity.

    // Here we want to provide 1 WETH along with the necessary WBTC amount.
    const oneWETH = getCurrencyAmount(WETH, '1');
    // We find the necessary amount of WBTC to pair with 1 WETH.
    // Since WETH is token1 in the pool, we use `Position.fromAmount1()`.
    const wbtcRawAmount = Position.fromAmount1({
      pool: position.pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amount1: oneWETH.quotient,
    }).mintAmounts.amount0;
    // Now we find the liquidity amount that can be added by providing 1 WETH and `wbtcRawAmount` of WBTC.
    const liquidityToAdd = Position.fromAmounts({
      pool: position.pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amount0: oneWETH.quotient,
      amount1: wbtcRawAmount,
      useFullPrecision: false,
    }).liquidity;

    // Approve Uniswap NPM to spend WBTC. Since we are providing native ether in this example, we don't need to approve WETH.
    await IERC20__factory.connect(WBTC_ADDRESS, eoaSigner).approve(
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
      wbtcRawAmount.toString(),
    );

    // We are now ready to generate and send out the add-liquidity tx.
    const addLiquidityTxRequest = await getAddLiquidityTx(
      {
        slippageTolerance: new Percent(0),
        deadline: Math.floor(Date.now() / 1000),
        tokenId: positionId,
        // Note that `useNative` can be set to true when WETH is one of the two tokens, and the user chooses to provide native ether. Otherwise, this field can be undefined.
        useNative: getNativeCurrency(chainId),
      },
      chainId,
      hardhatForkProvider,
      liquidityToAdd,
      position,
    );
    await (await eoaSigner.sendTransaction(addLiquidityTxRequest)).wait();
    expect(
      (await getBasicPositionInfo(chainId, positionId, hardhatForkProvider))
        .liquidity!,
    ).to.equal(liquidityToAdd.toString());

    // ------- Create Position -------
    // Now we create a new WBTC-WETH position.
    // We wish to provide liquidity to the 12.5 ~ 27.5 WETH per WBTC price range, to the HIGH fee-tier pool.
    // And we want to provide 0.1 WBTC paired with the necessary amount of WETH.

    // First, we align the price range's endpoints.
    const poolFee = FeeAmount.HIGH;
    const alignedPriceLower = alignPriceToClosestUsableTick(
      parsePrice(WBTC, WETH, '12.5'),
      poolFee,
    );
    const alignedPriceUpper = alignPriceToClosestUsableTick(
      parsePrice(WBTC, WETH, '27.5'),
      poolFee,
    );
    expect(alignedPriceLower.toFixed(6)).to.equal('12.589601');
    expect(alignedPriceUpper.toFixed(6)).to.equal('27.462794');

    // Second, we construct the `Position` object for the position we want to create.
    // We want to provide 0.1 WBTC and the necessary amount of WETH.
    const wbtcAmount = getCurrencyAmount(WBTC, '0.1');
    const tickLower = priceToClosestUsableTick(alignedPriceLower, poolFee);
    const tickUpper = priceToClosestUsableTick(alignedPriceUpper, poolFee);
    const pool = await getPool(
      WBTC,
      WETH,
      poolFee,
      chainId,
      hardhatForkProvider,
    );
    // Since WBTC is token0, we use `Position.fromAmount0()`.
    const positionToCreate = Position.fromAmount0({
      pool,
      tickLower,
      tickUpper,
      amount0: wbtcAmount.quotient,
      useFullPrecision: false,
    });
    // Now we know that we need to provide 0.1 WBTC and 0.568256298587835347 WETH.
    expect(
      CurrencyAmount.fromRawAmount(
        WBTC,
        positionToCreate.mintAmounts.amount0,
      ).toExact(),
    ).to.equal('0.1');
    expect(
      CurrencyAmount.fromRawAmount(
        WETH,
        positionToCreate.mintAmounts.amount1,
      ).toExact(),
    ).to.equal('0.568256298587835347');

    // Approve Uniswap NPM to spend WBTC.
    await IERC20__factory.connect(WBTC_ADDRESS, eoaSigner).approve(
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
      positionToCreate.mintAmounts.amount0.toString(),
    );

    // Approve Uniswap NPM to spend WETH.
    await WETH__factory.connect(WETH_ADDRESS, eoaSigner).deposit({
      value: positionToCreate.mintAmounts.amount1.toString(),
    });
    await WETH__factory.connect(WETH_ADDRESS, eoaSigner).approve(
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
      positionToCreate.mintAmounts.amount1.toString(),
    );

    // We are now ready to generate and send out the create-position tx.
    const createPositionTxRequest = await getCreatePositionTx(
      positionToCreate,
      {
        slippageTolerance: new Percent(5, 100),
        deadline: Math.floor(Date.now() / 1000),
        recipient: eoa,
      },
      chainId,
      hardhatForkProvider,
    );
    const createPositionTxReceipt = await (
      await eoaSigner.sendTransaction(createPositionTxRequest)
    ).wait();
    const createdPositionId = getMintedPositionIdFromTxReceipt(
      chainId,
      createPositionTxReceipt,
      eoa,
    )!;
    expect(
      await getBasicPositionInfo(
        chainId,
        createdPositionId,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      fee: positionToCreate.pool.fee,
      liquidity: positionToCreate.liquidity.toString(),
      tickLower: positionToCreate.tickLower,
      tickUpper: positionToCreate.tickUpper,
      token0: WBTC,
      token1: WETH,
    });
  });
});

describe('WETH transaction tests', function () {
  beforeEach(async function () {
    await resetHardhatNetwork();
  });

  it('Deposit and withdraw WETH', async function () {
    const wethContract = WETH__factory.connect(
      WETH_ADDRESS,
      hardhatForkProvider,
    );
    const wethBalanceBefore = await wethContract.balanceOf(WHALE_ADDRESS);
    const WETH = await getToken(WETH_ADDRESS, chainId, hardhatForkProvider);
    const wrapAmount = getCurrencyAmount(WETH, '10').quotient.toString();
    const whaleSigner = await ethers.getImpersonatedSigner(WHALE_ADDRESS);
    await (
      await whaleSigner.sendTransaction(getWrapETHTx(chainId, wrapAmount))
    ).wait();
    expect(
      (await wethContract.balanceOf(WHALE_ADDRESS)).eq(
        wethBalanceBefore.add(wrapAmount),
      ),
    ).to.equal(true);
    await (
      await whaleSigner.sendTransaction(getUnwrapETHTx(chainId, wrapAmount))
    ).wait();
    expect(
      (await wethContract.balanceOf(WHALE_ADDRESS)).eq(
        wethBalanceBefore.toString(),
      ),
    ).to.equal(true);
  });
});

describe('Automan transaction tests', function () {
  const positionId = 4;
  let automanContract: UniV3Automan;
  let impersonatedOwnerSigner: Signer;
  const automanAddress = getChainInfo(chainId).aperture_uniswap_v3_automan;

  beforeEach(async function () {
    await resetHardhatNetwork();

    // Without this, Hardhat throws an InvalidInputError saying that WHALE_ADDRESS is an unknown account.
    // Likely a Hardhat bug.
    await hardhatForkProvider.getBalance(WHALE_ADDRESS);

    // Deploy Automan.
    automanContract = await new UniV3Automan__factory(
      await ethers.getImpersonatedSigner(WHALE_ADDRESS),
    ).deploy(
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
      /*owner=*/ WHALE_ADDRESS,
    );
    await automanContract.deployed();
    await automanContract.setFeeConfig({
      feeCollector: WHALE_ADDRESS,
      // Set the max fee deduction to 50%.
      feeLimitPips: BigNumber.from('500000000000000000'),
    });
    await automanContract.setControllers([WHALE_ADDRESS], [true]);
    const router = await new OptimalSwapRouter__factory(
      await ethers.getImpersonatedSigner(WHALE_ADDRESS),
    ).deploy(getChainInfo(chainId).uniswap_v3_nonfungible_position_manager);
    await router.deployed();
    await automanContract.setSwapRouters([router.address], [true]);

    // Set Automan address in CHAIN_ID_TO_INFO.
    getChainInfo(chainId).aperture_uniswap_v3_automan =
      automanContract.address as `0x${string}`;
    getChainInfo(chainId).optimal_swap_router = router.address as `0x${string}`;

    // Owner of position id 4 sets Automan as operator.
    impersonatedOwnerSigner = await ethers.getImpersonatedSigner(eoa);
    await getNPM(chainId, impersonatedOwnerSigner).setApprovalForAll(
      automanContract.address,
      true,
    );

    // Tag contract addresses for tracing.
    hre.tracer.nameTags[automanContract.address] = 'Automan';
    hre.tracer.nameTags[router.address] = 'OptimalSwapRouter';
  });

  after(() => {
    // Reset Automan address in CHAIN_ID_TO_INFO.
    getChainInfo(chainId).aperture_uniswap_v3_automan = automanAddress;
  });

  it('Rebalance', async function () {
    const existingPosition = await getPosition(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    const { tx: txRequest } = await getRebalanceTx(
      chainId,
      eoa,
      positionId,
      240000,
      300000,
      /*slippageTolerance=*/ new Percent(1, 100),
      /*deadlineEpochSeconds=*/ Math.floor(Date.now() / 1000),
      hardhatForkProvider,
      existingPosition,
    );
    const txReceipt = await (
      await impersonatedOwnerSigner.sendTransaction(txRequest)
    ).wait();
    const newPositionId = getMintedPositionIdFromTxReceipt(
      chainId,
      txReceipt,
      eoa,
    )!;
    expect(
      await getBasicPositionInfo(chainId, newPositionId, hardhatForkProvider),
    ).to.deep.equal({
      token0: existingPosition.pool.token0,
      token1: existingPosition.pool.token1,
      fee: existingPosition.pool.fee,
      liquidity: '13291498909567',
      tickLower: 240000,
      tickUpper: 300000,
    });
  });

  async function dealERC20(
    chainId: ApertureSupportedChainId,
    token0: string,
    token1: string,
    amount0: BigNumberish,
    amount1: BigNumberish,
    from: string,
    to: string,
  ) {
    const provider = new ethers.providers.InfuraProvider(chainId);
    const [token0Overrides, token1Overrides] = await Promise.all([
      getERC20Overrides(token0, from, to, amount0, provider),
      getERC20Overrides(token1, from, to, amount1, provider),
    ]);
    for (const slot of Object.keys(token0Overrides[token0].stateDiff!)) {
      await hardhatForkProvider.send('hardhat_setStorageAt', [
        token0,
        slot,
        defaultAbiCoder.encode(['uint256'], [amount0]),
      ]);
    }
    for (const slot of Object.keys(token1Overrides[token1].stateDiff!)) {
      await hardhatForkProvider.send('hardhat_setStorageAt', [
        token1,
        slot,
        defaultAbiCoder.encode(['uint256'], [amount1]),
      ]);
    }
  }

  it('Rebalance with 1inch', async function () {
    const existingPosition = await getPosition(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    await dealERC20(
      chainId,
      existingPosition.pool.token0.address,
      existingPosition.pool.token1.address,
      existingPosition.amount0.multiply(2).quotient.toString(),
      existingPosition.amount1.multiply(2).quotient.toString(),
      eoa,
      getChainInfo(chainId).aperture_uniswap_v3_automan,
    );
    const { tx: txRequest } = await getRebalanceTx(
      chainId,
      eoa,
      positionId,
      240000,
      300000,
      /*slippageTolerance=*/ new Percent(50, 100),
      /*deadlineEpochSeconds=*/ Math.floor(Date.now() / 1000),
      // Hardhat provider doesn't support 'eth_createAccessList' and state overrides.
      new providers.MulticallProvider(hardhatForkProvider),
      existingPosition,
      undefined,
      true,
    );
    const txReceipt = await (
      await impersonatedOwnerSigner.sendTransaction(txRequest)
    ).wait();
    const newPositionId = getMintedPositionIdFromTxReceipt(
      chainId,
      txReceipt,
      eoa,
    )!;
    expect(
      await getBasicPositionInfo(chainId, newPositionId, hardhatForkProvider),
    ).to.deep.contains({
      token0: existingPosition.pool.token0,
      token1: existingPosition.pool.token1,
      fee: existingPosition.pool.fee,
      tickLower: 240000,
      tickUpper: 300000,
    });
  });

  it('Optimal mint', async function () {
    const pool = await getPool(
      WBTC_ADDRESS,
      WETH_ADDRESS,
      FeeAmount.MEDIUM,
      chainId,
      hardhatForkProvider,
    );
    const amount0 = BigNumber.from(10).pow(pool.token0.decimals);
    const amount1 = BigNumber.from(10).pow(pool.token1.decimals);
    const tickLower = nearestUsableTick(
      pool.tickCurrent - 1000,
      pool.tickSpacing,
    );
    const tickUpper = nearestUsableTick(
      pool.tickCurrent + 1000,
      pool.tickSpacing,
    );
    await dealERC20(
      chainId,
      pool.token0.address,
      pool.token1.address,
      amount0,
      amount1,
      eoa,
      getChainInfo(chainId).aperture_uniswap_v3_automan,
    );
    const tx = await getOptimalMintTx(
      chainId,
      CurrencyAmount.fromRawAmount(pool.token0, amount0.toString()),
      CurrencyAmount.fromRawAmount(pool.token1, amount1.toString()),
      FeeAmount.MEDIUM,
      tickLower,
      tickUpper,
      eoa,
      Math.floor(Date.now() / 1000) + 60,
      0.5,
      new providers.MulticallProvider(hardhatForkProvider),
      false,
    );
    const txReceipt = await (
      await impersonatedOwnerSigner.sendTransaction(tx)
    ).wait();
    const newPositionId = getMintedPositionIdFromTxReceipt(
      chainId,
      txReceipt,
      eoa,
    )!;
    expect(
      await getBasicPositionInfo(chainId, newPositionId, hardhatForkProvider),
    ).to.deep.contains({
      token0: pool.token0,
      token1: pool.token1,
      fee: pool.fee,
      tickLower,
      tickUpper,
    });
  });

  it('Test getZapOutTx', async function () {
    const { tx } = await getZapOutTx(
      chainId,
      eoa,
      positionId,
      true,
      /*slippageTolerance=*/ new Percent(1, 100),
      /*deadlineEpochSeconds=*/ Math.floor(Date.now() / 1000),
      hardhatForkProvider,
    );
    const eoaSigner = await ethers.getImpersonatedSigner(eoa);
    await (await eoaSigner.sendTransaction(tx)).wait();
  });

  it('Reinvest', async function () {
    const liquidityBeforeReinvest = (
      await getBasicPositionInfo(chainId, positionId, hardhatForkProvider)
    ).liquidity!;
    const { tx: txRequest } = await getReinvestTx(
      chainId,
      eoa,
      positionId,
      /*slippageTolerance=*/ new Percent(1, 100),
      /*deadlineEpochSeconds=*/ Math.floor(Date.now() / 1000),
      hardhatForkProvider,
    );
    await (await impersonatedOwnerSigner.sendTransaction(txRequest)).wait();
    const liquidityAfterReinvest = (
      await getBasicPositionInfo(chainId, positionId, hardhatForkProvider)
    ).liquidity!;
    expect(liquidityBeforeReinvest.toString()).to.equal('34399999543676');
    expect(liquidityAfterReinvest.toString()).to.equal('39910987438794');
    expect(
      generateAutoCompoundRequestPayload(
        eoa,
        chainId,
        positionId,
        /*feeToPrincipalRatioThreshold=*/ 0.1,
        /*slippage=*/ 0.05,
        /*maxGasProportion=*/ 0.01,
        1627776000,
      ),
    ).to.deep.equal({
      action: {
        maxGasProportion: 0.01,
        slippage: 0.05,
        type: ActionTypeEnum.enum.Reinvest,
      },
      chainId: 1,
      condition: {
        feeToPrincipalRatioThreshold: 0.1,
        type: ConditionTypeEnum.enum.AccruedFees,
      },
      nftId: positionId.toString(),
      ownerAddr: eoa,
      expiration: 1627776000,
    });
  });
});

describe('State overrides tests', function () {
  it('Test computeOperatorApprovalSlot', async function () {
    await resetHardhatNetwork();
    const impersonatedOwnerSigner = await ethers.getImpersonatedSigner(eoa);
    // Deploy Automan.
    const automanContract = await new UniV3Automan__factory(
      await ethers.getImpersonatedSigner(WHALE_ADDRESS),
    ).deploy(
      getChainInfo(chainId).uniswap_v3_nonfungible_position_manager,
      /*owner=*/ WHALE_ADDRESS,
    );
    await automanContract.deployed();
    const npm = getChainInfo(chainId).uniswap_v3_nonfungible_position_manager;
    const slot = computeOperatorApprovalSlot(eoa, automanContract.address);
    expect(slot).to.equal(
      '0x0e19f2cddd2e7388039c7ef081490ef6bd2600540ca6caf0f478dc7dfebe509b',
    );
    expect(await hardhatForkProvider.getStorageAt(npm, slot)).to.equal(
      defaultAbiCoder.encode(['bool'], [false]),
    );
    await getNPM(chainId, impersonatedOwnerSigner).setApprovalForAll(
      automanContract.address,
      true,
    );
    expect(await hardhatForkProvider.getStorageAt(npm, slot)).to.equal(
      defaultAbiCoder.encode(['bool'], [true]),
    );
  });

  it('Test generateAccessList', async function () {
    const provider = new ethers.providers.InfuraProvider(chainId);
    const balanceOfData = IERC20__factory.createInterface().encodeFunctionData(
      'balanceOf',
      [eoa],
    );
    const { accessList } = await generateAccessList(
      {
        from: eoa,
        to: WETH_ADDRESS,
        data: balanceOfData,
      },
      provider,
    );
    expect(accessList[0].storageKeys[0]).to.equal(
      '0x5408245386fab212e3c3357882670a5f5af556f7edf543831e2995afd71f4348',
    );
  });

  it('Test getTokensOverrides', async function () {
    const provider = new ethers.providers.InfuraProvider(chainId);
    const amount0Desired = '1000000000000000000';
    const amount1Desired = '100000000';
    const { aperture_uniswap_v3_automan } = getChainInfo(chainId);
    const stateOverrides = {
      ...(await getERC20Overrides(
        WETH_ADDRESS,
        eoa,
        aperture_uniswap_v3_automan,
        amount0Desired,
        provider,
      )),
      ...(await getERC20Overrides(
        WBTC_ADDRESS,
        eoa,
        aperture_uniswap_v3_automan,
        amount1Desired,
        provider,
      )),
    };
    expect(stateOverrides).to.deep.equal({
      [WETH_ADDRESS]: {
        stateDiff: {
          '0x5408245386fab212e3c3357882670a5f5af556f7edf543831e2995afd71f4348':
            '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
          '0x746950bb1accd12acebc948663f14ea555a83343e6f94af3b6143301c7cadd30':
            '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
        },
      },
      [WBTC_ADDRESS]: {
        stateDiff: {
          '0x45746063dcd859f1d120c6388dbc814c95df435a74a62b64d984ad16fe434fff':
            '0x0000000000000000000000000000000000000000000000000000000005f5e100',
          '0x71f8d5def281e31983e4625bff84022ae0c3d962552b2a6a1798de60e3860703':
            '0x0000000000000000000000000000000000000000000000000000000005f5e100',
        },
      },
    });
  });

  it('Test simulateMintOptimal', async function () {
    const blockNumber = 17975698;
    const provider = new ethers.providers.InfuraProvider(chainId);
    const token0 = WBTC_ADDRESS;
    const token1 = WETH_ADDRESS;
    const fee = FeeAmount.MEDIUM;
    const amount0Desired = '100000000';
    const amount1Desired = '1000000000000000000';
    const pool = await getPool(
      token0,
      token1,
      fee,
      chainId,
      undefined,
      blockNumber,
    );
    const mintParams = {
      token0,
      token1,
      fee,
      tickLower: nearestUsableTick(
        pool.tickCurrent - 10 * pool.tickSpacing,
        pool.tickSpacing,
      ),
      tickUpper: nearestUsableTick(
        pool.tickCurrent + 10 * pool.tickSpacing,
        pool.tickSpacing,
      ),
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: eoa,
      deadline: Math.floor(Date.now() / 1000 + 60 * 30),
    };
    const { liquidity, amount0, amount1 } = await simulateMintOptimal(
      chainId,
      provider,
      eoa,
      mintParams,
      undefined,
      blockNumber,
    );
    expect(liquidity.toString()).to.equal('716894157038546');
    expect(amount0.toString()).to.equal('51320357');
    expect(amount1.toString()).to.equal('8736560293857784398');
  });
});

describe('Position util tests', function () {
  let inRangePosition: Position;

  beforeEach(async function () {
    await resetHardhatNetwork();
    inRangePosition = await getPosition(chainId, 4, hardhatForkProvider);
  });

  it('Position approval', async function () {
    const chainInfo = getChainInfo(chainId);
    const automanAddress = chainInfo.aperture_uniswap_v3_automan;
    // This position is owned by `eoa`.
    const positionId = 4;
    expect(
      await checkPositionApprovalStatus(
        positionId,
        undefined,
        chainId,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: false,
      owner: eoa,
      reason: 'missingSignedPermission',
    });

    const npm = getNPM(chainId, await ethers.getImpersonatedSigner(eoa));
    await npm.setApprovalForAll(automanAddress, true);
    expect(
      await checkPositionApprovalStatus(
        positionId,
        undefined,
        chainId,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: true,
      owner: eoa,
      reason: 'onChainUserLevelApproval',
    });

    await npm.approve(automanAddress, positionId);
    expect(
      await checkPositionApprovalStatus(
        positionId,
        undefined,
        chainId,
        hardhatForkProvider,
      ),
    ).to.deep.include({
      hasAuthority: true,
      reason: 'onChainPositionSpecificApproval',
    });

    expect(
      await checkPositionApprovalStatus(
        0, // Nonexistent position id.
        undefined,
        chainId,
        hardhatForkProvider,
      ),
    ).to.deep.include({
      hasAuthority: false,
      reason: 'nonexistentPositionId',
    });

    // Construct and sign a permit digest that approves position id 4.
    const wallet = new ethers.Wallet(TEST_WALLET_PRIVATE_KEY);
    const permitTypedData = await generateTypedDataForPermit(
      chainId,
      positionId,
      deadline,
      hardhatForkProvider,
    );
    const signature = await wallet._signTypedData(
      permitTypedData.domain,
      permitTypedData.types,
      permitTypedData.value,
    );

    // Transfer position id 4 from `eoa` to the test wallet.
    await npm.transferFrom(eoa, wallet.address, positionId);

    // Check test wallet's permit.
    expect(
      await checkPositionApprovalStatus(
        positionId,
        {
          deadline,
          signature,
        },
        chainId,
        hardhatForkProvider,
      ),
    ).to.deep.include({
      hasAuthority: true,
      reason: 'offChainPositionSpecificApproval',
    });

    // Test permit message with an incorrect position id.
    const anotherPermitTypedData = await generateTypedDataForPermit(
      chainId,
      positionId + 1,
      deadline,
      hardhatForkProvider,
    );
    const anotherSignature = await wallet._signTypedData(
      anotherPermitTypedData.domain,
      anotherPermitTypedData.types,
      anotherPermitTypedData.value,
    );
    expect(
      await checkPositionApprovalStatus(
        positionId,
        {
          deadline,
          signature: anotherSignature,
        },
        chainId,
        hardhatForkProvider,
      ),
    ).to.deep.include({
      hasAuthority: false,
      reason: 'invalidSignedPermission',
    });
  });

  it('Position in-range', async function () {
    const outOfRangePosition = await getPosition(
      chainId,
      7,
      hardhatForkProvider,
    );
    expect(isPositionInRange(inRangePosition)).to.equal(true);
    expect(isPositionInRange(outOfRangePosition)).to.equal(false);
  });

  it('Token Svg', async function () {
    const url = await getTokenSvg(chainId, 4, hardhatForkProvider);
    expect(url.toString().slice(0, 60)).to.equal(
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjkwIiBoZWlnaHQ9Ij',
    );
  });

  it('Token value proportion to price conversion', async function () {
    const price = getRawRelativePriceFromTokenValueProportion(
      inRangePosition.tickLower,
      inRangePosition.tickUpper,
      new Big('0.3'),
    );
    expect(price.toString()).to.equal(
      '226996287752.678057810335753063814267017558211732849518876855922215569664',
    );
    expect(
      getRawRelativePriceFromTokenValueProportion(
        inRangePosition.tickLower,
        inRangePosition.tickUpper,
        new Big('0'),
      ).toString(),
    ).to.equal(
      new Big(TickMath.getSqrtRatioAtTick(inRangePosition.tickUpper).toString())
        .pow(2)
        .div(Q192)
        .toString(),
    );
    expect(
      getRawRelativePriceFromTokenValueProportion(
        inRangePosition.tickLower,
        inRangePosition.tickUpper,
        new Big('1'),
      ).toString(),
    ).to.equal(
      new Big(TickMath.getSqrtRatioAtTick(inRangePosition.tickLower).toString())
        .pow(2)
        .div(Q192)
        .toString(),
    );

    // Verify that the calculated price indeed corresponds to ~30% of the position value in token0.
    const token0ValueProportion = getTokenValueProportionFromPriceRatio(
      inRangePosition.tickLower,
      inRangePosition.tickUpper,
      price,
    );
    expect(token0ValueProportion.toFixed(30)).to.equal(
      '0.299999999999999999999998780740',
    );

    // Verify that price condition is generated correctly.
    const condition = generatePriceConditionFromTokenValueProportion(
      inRangePosition.tickLower,
      inRangePosition.tickUpper,
      false,
      new Big('0.3'),
      /*durationSec=*/ 7200,
    );
    expect(PriceConditionSchema.safeParse(condition).success).to.equal(true);
    expect(condition).to.deep.equal({
      type: ConditionTypeEnum.enum.Price,
      lte: undefined,
      gte: '226996287752.678057810335753063814267017558211732849518876855922215569664',
      durationSec: 7200,
    });
    expect(
      generatePriceConditionFromTokenValueProportion(
        inRangePosition.tickLower,
        inRangePosition.tickUpper,
        true,
        new Big('0.95'),
        /*durationSec=*/ undefined,
      ),
    ).to.deep.equal({
      type: ConditionTypeEnum.enum.Price,
      lte: '104792862935.904580651554157750042230410340267140482472644533377909257225',
      gte: undefined,
      durationSec: undefined,
    });
    const ratio = new Big('0.299999999999999999999998780740');
    const pp = getRawRelativePriceFromTokenValueProportion(
      -887220,
      27720,
      ratio,
    );
    const DP = ratio.toString().length - 3;
    Big.DP = DP;
    const ratio2 = getTokenValueProportionFromPriceRatio(
      -887220,
      27720,
      new Big(pp.toString()),
    );
    expect(ratio.toFixed(DP)).to.equal(ratio2.toFixed(DP));
  });

  it('Test getRebalancedPosition', async function () {
    // rebalance to an out of range position
    const newTickLower = inRangePosition.tickUpper;
    const newTickUpper = newTickLower + 10 * TICK_SPACINGS[FeeAmount.MEDIUM];
    const newPosition = getRebalancedPosition(
      inRangePosition,
      newTickLower,
      newTickUpper,
    );
    expect(JSBI.toNumber(newPosition.amount1.quotient)).to.equal(0);
    const revertedPosition = getRebalancedPosition(
      newPosition,
      inRangePosition.tickLower,
      inRangePosition.tickUpper,
    );
    const amount0 = JSBI.toNumber(inRangePosition.amount0.quotient);
    expect(
      JSBI.toNumber(revertedPosition.amount0.quotient),
    ).to.be.approximately(amount0, amount0 / 1e6);
    const amount1 = JSBI.toNumber(inRangePosition.amount1.quotient);
    expect(
      JSBI.toNumber(revertedPosition.amount1.quotient),
    ).to.be.approximately(amount1, amount1 / 1e6);
    const liquidity = JSBI.toNumber(inRangePosition.liquidity);
    expect(JSBI.toNumber(revertedPosition.liquidity)).to.be.approximately(
      liquidity,
      liquidity / 1e6,
    );
  });

  it('Test getPositionAtPrice', async function () {
    // corresponds to tick -870686
    const smallPrice = new Big('1.5434597458370203830544e-38');
    const position = new Position({
      pool: new Pool(
        inRangePosition.pool.token0,
        inRangePosition.pool.token1,
        3000,
        '797207963837958202618833735859',
        '4923530363713842',
        46177,
      ),
      liquidity: 68488980,
      tickLower: -887220,
      tickUpper: 52980,
    });
    const position1 = getPositionAtPrice(position, smallPrice);
    expect(JSBI.toNumber(position1.amount0.quotient)).to.greaterThan(0);
    expect(JSBI.toNumber(position1.amount1.quotient)).to.equal(0);
    const position2 = getPositionAtPrice(
      position,
      fractionToBig(
        tickToPrice(
          inRangePosition.pool.token0,
          inRangePosition.pool.token1,
          inRangePosition.tickUpper,
        ),
      ),
    );
    expect(JSBI.toNumber(position2.amount0.quotient)).to.equal(0);
    expect(JSBI.toNumber(position2.amount1.quotient)).to.greaterThan(0);
    const rebalancedPosition = getRebalancedPosition(position1, 46080, 62160);
    expect(JSBI.toNumber(rebalancedPosition.amount0.quotient)).to.greaterThan(
      0,
    );
    expect(JSBI.toNumber(rebalancedPosition.amount1.quotient)).to.equal(0);
  });

  it('Test projectRebalancedPositionAtPrice', async function () {
    const priceUpper = tickToPrice(
      inRangePosition.pool.token0,
      inRangePosition.pool.token1,
      inRangePosition.tickUpper,
    );
    // rebalance to an out of range position
    const newTickLower = inRangePosition.tickUpper;
    const newTickUpper = newTickLower + 10 * TICK_SPACINGS[FeeAmount.MEDIUM];
    const positionRebalancedAtCurrentPrice = getRebalancedPosition(
      inRangePosition,
      newTickLower,
      newTickUpper,
    );
    const positionRebalancedAtTickUpper = projectRebalancedPositionAtPrice(
      inRangePosition,
      fractionToBig(priceUpper),
      newTickLower,
      newTickUpper,
    );
    expect(
      JSBI.toNumber(positionRebalancedAtTickUpper.amount1.quotient),
    ).to.equal(0);
    // if rebalancing at the upper tick, `token0` are bought back at a higher price, hence `amount0` will be lower
    expect(
      JSBI.toNumber(
        positionRebalancedAtCurrentPrice.amount0.subtract(
          positionRebalancedAtTickUpper.amount0,
        ).quotient,
      ),
    ).to.greaterThan(0);
  });

  it('Test viewCollectableTokenAmounts', async function () {
    const positionId = 4;
    const position = await getBasicPositionInfo(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    const colletableTokenAmounts = await getCollectableTokenAmounts(
      chainId,
      positionId,
      hardhatForkProvider,
      position,
    );
    const viewOnlyColletableTokenAmounts = await viewCollectableTokenAmounts(
      chainId,
      positionId,
      hardhatForkProvider,
      position,
    );
    expect(colletableTokenAmounts).to.deep.equal(
      viewOnlyColletableTokenAmounts,
    );
    const positionDetails = await PositionDetails.fromPositionId(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    expect(colletableTokenAmounts).to.deep.equal({
      token0Amount: positionDetails.tokensOwed0,
      token1Amount: positionDetails.tokensOwed1,
    });
  });

  it('Test get position details', async function () {
    const { owner, position } = await PositionDetails.fromPositionId(
      chainId,
      4,
      hardhatForkProvider,
    );
    expect(owner).to.equal(eoa);
    expect(position).to.deep.equal(
      await getPosition(chainId, 4, hardhatForkProvider),
    );
  });

  it('Test getAllPositions', async function () {
    const provider = getPublicProvider(5);
    // an address with 90+ positions
    const address = '0xD68C7F0b57476D5C9e5686039FDFa03f51033a4f';
    const positions = await getAllPositionsDetails(address, chainId, provider);
    const basicPositions = await getAllPositionBasicInfoByOwner(
      address,
      chainId,
      provider,
    );
    expect(positions.size).to.equal(basicPositions.size);
    for (const [tokenId, pos] of positions.entries()) {
      const basicPosition = basicPositions.get(tokenId);
      expect(basicPosition).to.not.be.undefined;
      expect(basicPosition?.token0).to.deep.equal(pos.pool.token0);
      expect(basicPosition?.token1).to.deep.equal(pos.pool.token1);
      expect(basicPosition?.fee).to.equal(pos.pool.fee);
      expect(basicPosition?.liquidity).to.equal(pos.liquidity.toString());
      expect(basicPosition?.tickLower).to.equal(pos.tickLower);
      expect(basicPosition?.tickUpper).to.equal(pos.tickUpper);
    }
  });

  it('Test getReinvestedPosition', async function () {
    const chainId = ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID;
    const { aperture_uniswap_v3_automan } = getChainInfo(chainId);
    const provider = new ethers.providers.InfuraProvider(chainId);
    const positionId = 761879;
    const blockTag = 119626480;
    const npm = getNPM(chainId, provider);
    const opts = { blockTag };
    const owner = await npm.ownerOf(positionId, opts);
    expect(await npm.isApprovedForAll(owner, aperture_uniswap_v3_automan, opts))
      .to.be.false;
    const { liquidity } = await getReinvestedPosition(
      chainId,
      positionId,
      provider,
      blockTag,
    );
    await hardhatReset(
      `https://arbitrum-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      blockTag,
    );
    const signer = await ethers.getImpersonatedSigner(owner);
    await npm
      .connect(signer)
      .setApprovalForAll(aperture_uniswap_v3_automan, true);
    const { liquidity: liquidityBefore } = await getPosition(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    const { data } = getAutomanReinvestCallInfo(
      positionId,
      Math.round(new Date().getTime() / 1000 + 60 * 10), // 10 minutes from now.
    );
    await signer.sendTransaction({
      from: owner,
      to: aperture_uniswap_v3_automan,
      data,
    });
    const { liquidity: liquidityAfter } = await getPosition(
      chainId,
      positionId,
      hardhatForkProvider,
    );
    expect(JSBI.subtract(liquidityAfter, liquidityBefore).toString()).to.equal(
      liquidity.toString(),
    );
  });
});

describe('Pool subgraph query tests', function () {
  it('Fee tier distribution', async function () {
    const [distribution, distributionOppositeTokenOrder] = await Promise.all([
      getFeeTierDistribution(chainId, WBTC_ADDRESS, WETH_ADDRESS),
      getFeeTierDistribution(chainId, WETH_ADDRESS, WBTC_ADDRESS),
    ]);
    expect(distribution).to.deep.equal(distributionOppositeTokenOrder);
    expect(
      Object.values(distribution).reduce(
        (partialSum, num) => partialSum + num,
        0,
      ),
    ).to.be.approximately(/*expected=*/ 1, /*delta=*/ 1e-9);
  });

  async function testLiquidityDistribution(
    chainId: ApertureSupportedChainId,
    pool: Pool,
  ) {
    const tickCurrentAligned =
      Math.floor(pool.tickCurrent / pool.tickSpacing) * pool.tickSpacing;
    const tickLower = pool.tickCurrent - DOUBLE_TICK;
    const tickUpper = pool.tickCurrent + DOUBLE_TICK;
    const [liquidityArr, tickToLiquidityMap] = await Promise.all([
      getLiquidityArrayForPool(chainId, pool, tickLower, tickUpper),
      getTickToLiquidityMapForPool(chainId, pool, tickLower, tickUpper),
    ]);
    expect(liquidityArr.length).to.be.greaterThan(0);
    expect(tickToLiquidityMap.size).to.be.greaterThan(0);
    for (const liquidity of tickToLiquidityMap.values()) {
      expect(JSBI.greaterThanOrEqual(liquidity, JSBI.BigInt(0))).to.equal(true);
    }
    expect(
      liquidityArr[
        liquidityArr.findIndex(({ tick }) => tick > tickCurrentAligned) - 1
      ].liquidityActive,
    ).to.equal(pool.liquidity.toString());
  }

  it('Tick liquidity distribution - Ethereum mainnet', async function () {
    const pool = await getPool(
      WBTC_ADDRESS,
      WETH_ADDRESS,
      FeeAmount.LOW,
      chainId,
      getPublicProvider(chainId),
    );
    await testLiquidityDistribution(chainId, pool);
  });

  it('Tick liquidity distribution - Arbitrum mainnet', async function () {
    const arbitrumChainId = ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID;
    const WETH_ARBITRUM = getAddress(
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    );
    const USDC_ARBITRUM = getAddress(
      '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
    );
    const pool = await getPool(
      WETH_ARBITRUM,
      USDC_ARBITRUM,
      FeeAmount.LOW,
      arbitrumChainId,
      getPublicProvider(arbitrumChainId),
    );
    await testLiquidityDistribution(arbitrumChainId, pool);
  });

  it('Get all pools', async function () {
    const pools = await getPoolsFromSubgraph(
      ApertureSupportedChainId.MANTA_PACIFIC_MAINNET_CHAIN_ID,
    );
    const whitelistedPools = getWhitelistedPools(
      ApertureSupportedChainId.MANTA_PACIFIC_MAINNET_CHAIN_ID,
      pools,
    );
    expect(whitelistedPools.size).to.be.greaterThanOrEqual(6);
  });
});

describe('Routing tests', function () {
  it('Fetch quote swapping 1 ETH for USDC on mainnet', async function () {
    const quote = await fetchQuoteFromRoutingApi(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      'ETH',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC mainnet
      '1000000000000000000',
      'exactIn',
    );
    expect(quote.amountDecimals === '1');
    expect(Number(quote.quoteDecimals)).to.be.greaterThan(0);
    console.log(`1 ETH -> ${quote.quoteDecimals} USDC`);
  });

  it('Fetch quote swapping 1 ETH for USDC on Manta Pacific testnet', async function () {
    const quote = await fetchQuoteFromSpecifiedRoutingApiInfo(
      3441005 as ApertureSupportedChainId,
      {
        url: 'https://uniswap-routing.aperture.finance/quote',
        type: 'ROUTING_API',
      },
      'ETH',
      '0x39471BEe1bBe79F3BFA774b6832D6a530edDaC6B',
      '1000000000000000000',
      'exactIn',
    );
    expect(quote.amountDecimals === '1');
    expect(Number(quote.quoteDecimals)).to.be.greaterThan(0);
    console.log(`1 ETH -> ${quote.quoteDecimals} USDC`);
  });

  it('Fetch quote swapping 1 USDC for ETH on Scroll mainnet', async function () {
    const quote = await fetchQuoteFromRoutingApi(
      ApertureSupportedChainId.SCROLL_MAINNET_CHAIN_ID,
      '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', // USDC on Scroll
      'ETH',
      '1000000',
      'exactIn',
    );
    expect(quote.amountDecimals === '1');
    expect(Number(quote.quoteDecimals)).to.be.greaterThan(0);
    console.log(`1 USDC -> ${quote.quoteDecimals} ETH`);
  });

  it('Test optimalMint', async function () {
    const chainId = ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID;
    const provider = new ethers.providers.InfuraProvider(chainId);
    const token0 = '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f';
    const token1 = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
    const fee = FeeAmount.MEDIUM;
    const pool = await getPool(token0, token1, fee, chainId);
    const token0Amount = CurrencyAmount.fromRawAmount(
      pool.token0,
      '1000000000',
    );
    const token1Amount = CurrencyAmount.fromRawAmount(
      pool.token1,
      '1000000000000000000',
    );
    const tickLower = nearestUsableTick(
      pool.tickCurrent - 10 * pool.tickSpacing,
      pool.tickSpacing,
    );
    const tickUpper = nearestUsableTick(
      pool.tickCurrent + 10 * pool.tickSpacing,
      pool.tickSpacing,
    );
    const { amount0, amount1 } = await optimalMint(
      chainId,
      token0Amount,
      token1Amount,
      fee,
      tickLower,
      tickUpper,
      eoa,
      0.1,
      provider,
    );
    const _total = Number(
      pool.token0Price
        .quote(CurrencyAmount.fromRawAmount(pool.token0, amount0.toString()))
        .add(CurrencyAmount.fromRawAmount(pool.token1, amount1.toString()))
        .toFixed(),
    );
    const total = Number(
      pool.token0Price.quote(token0Amount).add(token1Amount).toFixed(),
    );
    expect(_total).to.be.closeTo(total, total * 0.005);
  });

  it('Test optimalRebalance', async function () {
    const chainId = ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID;
    const provider = new ethers.providers.JsonRpcProvider(
      process.env.ARBITRUM_RPC_URL,
    );
    const tokenId = 726230;
    const { pool, position } = await PositionDetails.fromPositionId(
      chainId,
      tokenId,
      provider,
    );
    const tickLower = nearestUsableTick(
      pool.tickCurrent - 10 * pool.tickSpacing,
      pool.tickSpacing,
    );
    const tickUpper = nearestUsableTick(
      pool.tickCurrent + 10 * pool.tickSpacing,
      pool.tickSpacing,
    );
    const { liquidity } = await optimalRebalance(
      chainId,
      tokenId,
      tickLower,
      tickUpper,
      0,
      true,
      await getNPM(chainId, provider).ownerOf(tokenId),
      0.1,
      provider,
    );
    const { liquidity: predictedLiquidity } = getRebalancedPosition(
      position,
      tickLower,
      tickUpper,
    );
    expect(liquidity.toNumber()).to.be.closeTo(
      Number(predictedLiquidity.toString()),
      Number(predictedLiquidity.toString()) * 0.1,
    );
  });

  it('Test optimal zap out', async function () {
    const chainId = ApertureSupportedChainId.ARBITRUM_MAINNET_CHAIN_ID;
    const provider = new ethers.providers.InfuraProvider(chainId);
    const tokenId = 726230;
    const { amount } = await optimalZapOut(
      chainId,
      tokenId,
      false,
      1e12,
      await getNPM(chainId, provider).ownerOf(tokenId),
      0.1,
      provider,
    );
    console.log('zap out amount', amount.toString());
  });

  it('Test automation eligiblity', async function () {
    const avaxProvider = getPublicProvider(
      ApertureSupportedChainId.AVALANCHE_MAINNET_CHAIN_ID,
    );
    const [SHIBe, USDC, WAVAX] = await Promise.all([
      getToken(
        '0x02D980A0D7AF3fb7Cf7Df8cB35d9eDBCF355f665',
        ApertureSupportedChainId.AVALANCHE_MAINNET_CHAIN_ID,
        avaxProvider,
      ),
      getToken(
        '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        ApertureSupportedChainId.AVALANCHE_MAINNET_CHAIN_ID,
        avaxProvider,
      ),
      getToken(
        '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
        ApertureSupportedChainId.AVALANCHE_MAINNET_CHAIN_ID,
        avaxProvider,
      ),
    ]);
    expect(
      await checkTokenLiquidityAgainstChainNativeCurrency(
        ApertureSupportedChainId.AVALANCHE_MAINNET_CHAIN_ID,
        SHIBe.address,
      ),
    ).to.equal('-1');
    expect(
      await checkTokenLiquidityAgainstChainNativeCurrency(
        ApertureSupportedChainId.AVALANCHE_MAINNET_CHAIN_ID,
        USDC.address,
      ),
    ).to.not.equal('-1');
    expect(
      await checkTokenLiquidityAgainstChainNativeCurrency(
        ApertureSupportedChainId.AVALANCHE_MAINNET_CHAIN_ID,
        WAVAX.address,
      ),
    ).to.equal('1');
    expect(await checkAutomationSupportForPool(SHIBe, WAVAX)).to.equal(false);
  });
});

describe('Optimism-like L2 total gas cost estimation tests', function () {
  it('Scroll mainnet', async function () {
    const scrollProvider = getPublicProvider(
      ApertureSupportedChainId.SCROLL_MAINNET_CHAIN_ID,
    );
    const totalGasCost = await estimateTotalGasCostForOptimismLikeL2Tx(
      {
        from: '0x01aB1be3518F490c9F0b97447FBb1c335EFbE600',
        to: '0x01aB1be3518F490c9F0b97447FBb1c335EFbE600',
        value: 1,
      },
      ApertureSupportedChainId.SCROLL_MAINNET_CHAIN_ID,
      scrollProvider,
    );
    expect(totalGasCost.gt('0')).to.equal(true);
  });

  it('Optimism mainnet', async function () {
    const scrollProvider = getPublicProvider(
      ApertureSupportedChainId.OPTIMISM_MAINNET_CHAIN_ID,
    );
    const totalGasCost = await estimateTotalGasCostForOptimismLikeL2Tx(
      {
        from: '0x01aB1be3518F490c9F0b97447FBb1c335EFbE600',
        to: '0x01aB1be3518F490c9F0b97447FBb1c335EFbE600',
        value: 1,
      },
      ApertureSupportedChainId.OPTIMISM_MAINNET_CHAIN_ID,
      scrollProvider,
    );
    expect(totalGasCost.gt('0')).to.equal(true);
  });
});
