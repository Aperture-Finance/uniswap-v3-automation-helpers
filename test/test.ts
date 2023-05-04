import chaiAsPromised from 'chai-as-promised';
import chai from 'chai';
import { ethers } from 'hardhat';
import { getToken } from '../currency';
import { ETHEREUM_MAINNET_CHAIN_ID, getChainInfo } from '../chain';
import { parsePrice } from '../price';
import { CurrencyAmount, Token } from '@uniswap/sdk-core';
import { getCurrencyAmount } from '../currency';
import { getCreatePositionTxForLimitOrder } from '../transaction';
import { FeeAmount, TICK_SPACINGS, tickToPrice } from '@uniswap/v3-sdk';
import { alignPriceToClosestUsableTick } from '../tick';
import { getPool } from '../pool';
import {
  IERC20__factory,
  INonfungiblePositionManager__factory,
} from '@aperture_finance/uniswap-v3-automation-sdk';
import { getBasicPositionInfo, getPositionFromBasicInfo } from '../position';
import {
  checkPositionApprovalStatus,
  generateTypedDataForPermit,
} from '../permission';

chai.use(chaiAsPromised);
const expect = chai.expect;
const hardhatForkProvider = ethers.provider;
// Owner of position id 4 on Ethereum mainnet.
const eoa = '0x4bD047CA72fa05F0B89ad08FE5Ba5ccdC07DFFBF';
// A fixed epoch second value representing a moment in the year 2099.
const deadline = 4093484400;

// Test wallet so we can test signing permit messages.
// Public key: 0x035dcbb4b39244cef94d3263074f358a1d789e6b99f278d5911f9694da54312636
// Address: 0x1ccaCD01fD2d973e134EC6d4F916b90A45634eCe
const TEST_WALLET_PRIVATE_KEY =
  '0x077646fb889571f9ce30e420c155812277271d4d914c799eef764f5709cafd5b';

describe('Transaction tests', function () {
  let WBTC: Token, WETH: Token;

  before(async function () {
    WBTC = await getToken(
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    WETH = await getToken(
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
  });

  it('Create position for limit order (selling WBTC for WETH)', async function () {
    const price = parsePrice(WBTC, WETH, '10.234');
    expect(price.toFixed(6)).to.equal('10.234000');
    const tenWBTC = getCurrencyAmount(WBTC, '10.0');
    expect(price.quote(tenWBTC as CurrencyAmount<Token>).toExact()).to.equal(
      '102.34',
    );

    const poolFee = FeeAmount.MEDIUM;
    await expect(
      getCreatePositionTxForLimitOrder(
        eoa,
        price,
        tenWBTC,
        poolFee,
        deadline,
        ETHEREUM_MAINNET_CHAIN_ID,
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
        ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.be.rejectedWith('Specified limit price lower than current price');

    const pool = await getPool(
      WETH,
      WBTC,
      poolFee,
      ETHEREUM_MAINNET_CHAIN_ID,
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
      ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    const npmAddress = getChainInfo(
      ETHEREUM_MAINNET_CHAIN_ID,
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
    await (await impersonatedEOA.sendTransaction(tx)).wait();
    const npmContract = INonfungiblePositionManager__factory.connect(
      npmAddress,
      hardhatForkProvider,
    );
    const positionId = await npmContract.tokenByIndex(
      (await npmContract.totalSupply()).sub(1),
    );
    const basicPositionInfo = await getBasicPositionInfo(
      ETHEREUM_MAINNET_CHAIN_ID,
      positionId,
      hardhatForkProvider,
    );
    expect(basicPositionInfo).to.deep.equal({
      token0: WBTC,
      token1: WETH,
      liquidity: '133959413978504760',
      tickLower: 258060,
      tickUpper: 258060 + TICK_SPACINGS[poolFee],
      fee: poolFee,
    });
    const position = await getPositionFromBasicInfo(
      basicPositionInfo,
      ETHEREUM_MAINNET_CHAIN_ID,
      hardhatForkProvider,
    );
    // The user actually provided 9.99999999 WBTC due to liquidity precision, i.e. 10 WBTC would have yielded the exact same liquidity amount of 133959413978504760.
    expect(position.amount0.quotient.toString()).to.equal('999999999');
    expect(position.amount1.quotient.toString()).to.equal('0');
  });
});

describe('Util tests', function () {
  it('Position approval', async function () {
    const chainInfo = getChainInfo(ETHEREUM_MAINNET_CHAIN_ID);
    const automanAddress = chainInfo.aperture_uniswap_v3_automan;
    // This position is owned by `eoa`.
    const positionId = 4;
    expect(
      await checkPositionApprovalStatus(
        positionId,
        undefined,
        ETHEREUM_MAINNET_CHAIN_ID,
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
        ETHEREUM_MAINNET_CHAIN_ID,
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
        ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: true,
      reason: 'onChainPositionSpecificApproval',
    });

    // Construct and sign a permit message approving position id 4.
    const wallet = new ethers.Wallet(TEST_WALLET_PRIVATE_KEY);
    const permitTypedData = await generateTypedDataForPermit(
      ETHEREUM_MAINNET_CHAIN_ID,
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
        ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.equal({
      hasAuthority: true,
      reason: 'offChainPositionSpecificApproval',
    });

    // Test permit message with an incorrect position id.
    const anotherPermitTypedData = await generateTypedDataForPermit(
      ETHEREUM_MAINNET_CHAIN_ID,
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
        ETHEREUM_MAINNET_CHAIN_ID,
        hardhatForkProvider,
      ),
    ).to.deep.include({
      hasAuthority: false,
      reason: 'invalidSignedPermission',
    });
  });
});
