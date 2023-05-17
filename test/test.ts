import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';
import { ethers } from 'hardhat';
import { getNativeCurrency, getToken } from '../currency';
import { ApertureSupportedChainId, getChainInfo } from '../chain';
import { parsePrice } from '../price';
import {
  CurrencyAmount,
  Fraction,
  Percent,
  Price,
  Token,
} from '@uniswap/sdk-core';
import { reset as hardhatReset } from '@nomicfoundation/hardhat-network-helpers';
import { getCurrencyAmount } from '../currency';
import {
  getAddLiquidityTx,
  getCollectTx,
  getCreatePositionTx,
  getCreatePositionTxForLimitOrder,
  getMintedPositionIdFromTxReceipt,
  getRemoveLiquidityTx,
} from '../transaction';
import {
  FeeAmount,
  Position,
  TICK_SPACINGS,
  priceToClosestTick,
  tickToPrice,
} from '@uniswap/v3-sdk';
import {
  alignPriceToClosestUsableTick,
  priceToClosestUsableTick,
} from '../tick';
import { getPool } from '../pool';
import {
  IERC20__factory,
  INonfungiblePositionManager__factory,
  WETH__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import {
  BasicPositionInfo,
  getBasicPositionInfo,
  getCollectableTokenAmounts,
  getPosition,
  getPositionFromBasicInfo,
  isPositionInRange,
} from '../position';
import {
  checkPositionApprovalStatus,
  generateTypedDataForPermit,
} from '../permission';
import { getWalletActivities } from '../activity';
import { generateLimitOrderCloseRequestPayload } from '../payload';
import { BigNumber } from 'ethers';

chai.use(chaiAsPromised);
const expect = chai.expect;
const hardhatForkProvider = ethers.provider;
const WBTC_ADDRESS = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
// Owner of position id 4 on Ethereum mainnet.
const eoa = '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF';
// A fixed epoch second value representing a moment in the year 2099.
const deadline = 4093484400;

// Test wallet so we can test signing permit messages.
// Public key: 0x035dcbb4b39244cef94d3263074f358a1d789e6b99f278d5911f9694da54312636
// Address: 0x1ccaCD01fD2d973e134EC6d4F916b90A45634eCe
const TEST_WALLET_PRIVATE_KEY =
  '0x077646fb889571f9ce30e420c155812277271d4d914c799eef764f5709cafd5b';

async function resetHardhatNetwork() {
  hardhatReset(
    `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
    /*blockNumber=*/ 17188000,
  );
}

describe('Limit order tests', function () {
  let WBTC: Token, WETH: Token;
  const poolFee = FeeAmount.MEDIUM;

  before(async function () {
    WBTC = await getToken(
      WBTC_ADDRESS,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    WETH = await getToken(
      WETH_ADDRESS,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
  });

  it('Selling WBTC for WETH', async function () {
    const price = parsePrice(WBTC, WETH, '10.234');
    expect(price.toFixed(6)).to.equal('10.234000');
    const tenWBTC = getCurrencyAmount(WBTC, '10.0');
    expect(price.quote(tenWBTC as CurrencyAmount<Token>).toExact()).to.equal(
      '102.34',
    );

    await expect(
      getCreatePositionTxForLimitOrder(
        eoa,
        price,
        tenWBTC,
        poolFee,
        deadline,
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.be.rejectedWith('Outer limit price not aligned');
    const alignedPrice = alignPriceToClosestUsableTick(price, poolFee);
    expect(alignedPrice.toFixed(9)).to.equal('10.205039374');
    await expect(
      getCreatePositionTxForLimitOrder(
        eoa,
        alignedPrice,
        tenWBTC,
        poolFee,
        deadline,
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.be.rejectedWith('Specified limit price lower than current price');

    const pool = await getPool(
      WETH,
      WBTC,
      poolFee,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
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
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    const npmAddress = getChainInfo(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
    ).uniswap_v3_nonfungible_position_manager;
    expect(tx).to.deep.equal({
      to: npmAddress,
      data: '0x883164560000000000000000000000002260fac5e5542a773aa44fbcfedf7c193bc2c599000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000003f00c000000000000000000000000000000000000000000000000000000000003f048000000000000000000000000000000000000000000000000000000003b9aca000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004bd047ca72fa05f0b89ad08fe5ba5ccdc07dffbf00000000000000000000000000000000000000000000000000000000f3fd9d70',
      value: '0x00',
    });
    // Top up 10 WBTC to `eoa` from `impersonatedWBTCWhale`.
    const impersonatedWBTCWhale = await ethers.getImpersonatedSigner(
      '0x8EB8a3b98659Cce290402893d0123abb75E3ab28',
    );
    await IERC20__factory.connect(WBTC.address, impersonatedWBTCWhale).transfer(
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
      txReceipt,
      eoa,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
    )!;
    const basicPositionInfo = await getBasicPositionInfo(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      positionId,
      hardhatForkProvider,
    );
    expect(basicPositionInfo).to.deep.equal({
      token0: WBTC,
      token1: WETH,
      liquidity: '133959413978504760',
      tickLower: priceToClosestTick(alignedLimitPrice) - TICK_SPACINGS[poolFee],
      tickUpper: priceToClosestTick(alignedLimitPrice),
      fee: poolFee,
    });
    const position = await getPositionFromBasicInfo(
      basicPositionInfo,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    // The user actually provided 9.99999999 WBTC due to liquidity precision, i.e. 10 WBTC would have yielded the exact same liquidity amount of 133959413978504760.
    expect(position.amount0.quotient.toString()).to.equal('999999999');
    expect(position.amount1.quotient.toString()).to.equal('0');
    expect(
      generateLimitOrderCloseRequestPayload(
        eoa,
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        positionId,
        alignedLimitPrice,
        tenWBTC,
        poolFee,
        /*maxGasProportion=*/ 0.2,
      ),
    ).to.deep.equal({
      action: {
        feeTier: 3000,
        inputTokenAmount: {
          address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
          rawAmount: '1000000000',
        },
        maxGasProportion: 0.2,
        outputTokenAddr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        type: 'LimitOrderClose',
      },
      chainId: 1,
      condition: {
        type: 'TokenAmount',
        zeroAmountToken: 0,
      },
      nftId: '500511',
      ownerAddr: '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF',
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
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.be.rejectedWith('Specified limit price lower than current price');

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
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    const npmAddress = getChainInfo(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
    ).uniswap_v3_nonfungible_position_manager;
    expect(tx).to.deep.equal({
      to: npmAddress,
      data: '0x883164560000000000000000000000002260fac5e5542a773aa44fbcfedf7c193bc2c599000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000003e508000000000000000000000000000000000000000000000000000000000003e54400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008ac7230489e7fe5900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008ac7230489e7fe590000000000000000000000004bd047ca72fa05f0b89ad08fe5ba5ccdc07dffbf00000000000000000000000000000000000000000000000000000000f3fd9d70',
      value: '0x00',
    });
    // Top up 10 WETH to `eoa` from `impersonatedWBTCWhale`.
    const impersonatedWETHWhale = await ethers.getImpersonatedSigner(
      '0x8EB8a3b98659Cce290402893d0123abb75E3ab28',
    );
    await IERC20__factory.connect(WETH.address, impersonatedWETHWhale).transfer(
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
      txReceipt,
      eoa,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
    )!;
    const basicPositionInfo = await getBasicPositionInfo(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
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
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
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
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        positionId,
        alignedLimitPrice,
        tenWETH,
        poolFee,
        /*maxGasProportion=*/ 0.2,
      ),
    ).to.deep.equal({
      action: {
        feeTier: 3000,
        inputTokenAmount: {
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          rawAmount: '10000000000000000000',
        },
        maxGasProportion: 0.2,
        outputTokenAddr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        type: 'LimitOrderClose',
      },
      chainId: 1,
      condition: {
        type: 'TokenAmount',
        zeroAmountToken: 1,
      },
      nftId: '500512',
      ownerAddr: '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF',
    });

    // Create another WETH -> WBTC limit order but provide native ether this time.
    const tenETH = getCurrencyAmount(
      getNativeCurrency(ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID),
      '10',
    );
    const nativeEthTx = await getCreatePositionTxForLimitOrder(
      eoa,
      alignedLimitPrice,
      tenETH,
      poolFee,
      deadline,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
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
      nativeEthTxReceipt,
      eoa,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
    )!;
    expect(
      await getBasicPositionInfo(
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
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
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        nativeEthPositionId,
        alignedLimitPrice,
        tenETH,
        poolFee,
        /*maxGasProportion=*/ 0.2,
      ),
    ).to.deep.equal({
      action: {
        feeTier: 3000,
        inputTokenAmount: {
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          rawAmount: '10000000000000000000',
        },
        maxGasProportion: 0.2,
        outputTokenAddr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        type: 'LimitOrderClose',
      },
      chainId: 1,
      condition: {
        type: 'TokenAmount',
        zeroAmountToken: 1,
      },
      nftId: '500513',
      ownerAddr: '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF',
    });
  });
});

describe('Position liquidity management tests', function () {
  const chainId = ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID;
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

    WBTC = await getToken(
      WBTC_ADDRESS,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    WETH = await getToken(
      WETH_ADDRESS,
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
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
    await (await eoaSigner.sendTransaction(txRequest)).wait();
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
      useFullPrecision: true,
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
      useFullPrecision: true,
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
  });
});

describe('Util tests', function () {
  beforeEach(async function () {
    await resetHardhatNetwork();
  });

  it('Position approval', async function () {
    const chainInfo = getChainInfo(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
    );
    const automanAddress = chainInfo.aperture_uniswap_v3_automan;
    // This position is owned by `eoa`.
    const positionId = 4;
    expect(
      await checkPositionApprovalStatus(
        positionId,
        undefined,
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: false,
      reason: 'missingSignedPermission',
    });

    const npm = INonfungiblePositionManager__factory.connect(
      chainInfo.uniswap_v3_nonfungible_position_manager,
      hardhatForkProvider,
    );
    const impersonatedOwnerSigner = await ethers.getImpersonatedSigner(eoa);
    const npmImpersonated = npm.connect(impersonatedOwnerSigner);
    await npmImpersonated.setApprovalForAll(automanAddress, true);
    expect(
      await checkPositionApprovalStatus(
        positionId,
        undefined,
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: true,
      reason: 'onChainUserLevelApproval',
    });

    await npmImpersonated.approve(automanAddress, positionId);
    expect(
      await checkPositionApprovalStatus(
        positionId,
        undefined,
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: true,
      reason: 'onChainPositionSpecificApproval',
    });

    // Construct and sign a permit message approving position id 4.
    const wallet = new ethers.Wallet(TEST_WALLET_PRIVATE_KEY);
    const permitTypedData = await generateTypedDataForPermit(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
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
    await npmImpersonated.transferFrom(eoa, wallet.address, positionId);

    // Check test wallet's permit.
    expect(
      await checkPositionApprovalStatus(
        positionId,
        {
          deadline,
          signature,
        },
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: true,
      reason: 'offChainPositionSpecificApproval',
    });

    // Test permit message with an incorrect position id.
    const anotherPermitTypedData = await generateTypedDataForPermit(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
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
        ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.include({
      hasAuthority: false,
      reason: 'invalidSignedPermission',
    });
  });

  it('Position in-range', async function () {
    const inRangePosition = await getPosition(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      4,
      hardhatForkProvider,
    );
    expect(isPositionInRange(inRangePosition)).to.equal(true);
    const outOfRangePosition = await getPosition(
      ApertureSupportedChainId.ETHEREUM_MAINNET_CHAIN_ID,
      7,
      hardhatForkProvider,
    );
    expect(isPositionInRange(outOfRangePosition)).to.equal(false);
  });
});

describe('Wallet activity tests', function () {
  it('Wallet activity', async function () {
    expect(
      (await getWalletActivities(
        '0x8B18687Ed4e32A5E1a3DeE91C08f706C196bb9C5',
      ))!['0x3849309604e9e1dd661cb92c8d64c6dcd56e491c84dddc033ce924da2e1c5655'],
    ).to.deep.equal({
      hash: '0x3849309604e9e1dd661cb92c8d64c6dcd56e491c84dddc033ce924da2e1c5655',
      chainId: 1,
      status: 'CONFIRMED',
      timestamp: 1682628731,
      logos: [
        'https://raw.githubusercontent.com/Uniswap/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
      ],
      title: 'Sent',
      descriptor: '624.29 USDC to ',
      receipt: {
        id: 'VHJhbnNhY3Rpb246MHgzODQ5MzA5NjA0ZTllMWRkNjYxY2I5MmM4ZDY0YzZkY2Q1NmU0OTFjODRkZGRjMDMzY2U5MjRkYTJlMWM1NjU1XzB4OGIxODY4N2VkNGUzMmE1ZTFhM2RlZTkxYzA4ZjcwNmMxOTZiYjljNV8weGEwYjg2OTkxYzYyMThiMzZjMWQxOWQ0YTJlOWViMGNlMzYwNmViNDg=',
        blockNumber: 17140004,
        hash: '0x3849309604e9e1dd661cb92c8d64c6dcd56e491c84dddc033ce924da2e1c5655',
        status: 'CONFIRMED',
        to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        from: '0x8b18687ed4e32a5e1a3dee91c08f706c196bb9c5',
        __typename: 'Transaction',
      },
      nonce: undefined,
      otherAccount: '0x95E333ea9f678111ED30c8f7A002d8C3aDA1EC09',
    });
  });
});
