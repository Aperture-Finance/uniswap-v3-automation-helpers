import axios from 'axios';
import { getAddress } from 'ethers/lib/utils';
import { appendFileSync, readFileSync } from 'fs';

import { getPublicProvider } from '../provider';

const provider = getPublicProvider(1);
const NETWORKS = ['mainnet', 'optimism', 'arbitrum', 'polygon'];
let fetchFailureCount = 0;
let invalidAddressCount = 0;

async function fetchUserInfoFromRevertFinance(address: string) {
  let data = '0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0';
  if (address === '') return data;
  try {
    if (address.length !== 42) {
      address = (await provider.resolveName(address)) ?? '';
    }
    if (address.length !== 42) return data;
    address = getAddress(address);
  } catch (err: any) {
    console.log(`Invalid address ${address} for reason "${err.message}"`);
    invalidAddressCount += 1;
    return data;
  }

  const fetchedData = (
    await Promise.all(
      NETWORKS.map((chain) =>
        axios.get(
          `https://staging-api.revert.finance/v1/positions/${chain}/uniswapv3/account/${address}`,
        ),
      ),
    )
  ).map((res) => res.data);
  if (
    !fetchedData[0].success ||
    !fetchedData[1].success ||
    !fetchedData[2].success ||
    !fetchedData[3].success
  ) {
    console.log(
      `Failed to fetch data from Revert Finance for address: ${address}`,
    );
    fetchFailureCount += 1;
  }

  data = '';
  for (let networkId = 0; networkId < 4; ++networkId) {
    const networkData = {
      openPositionNum: 0,
      openPositionTotalValue: 0,
      closedPositionNum: 0,
      closedPositionTotalPnLAbs: 0,
    };
    for (const position of fetchedData[networkId].data) {
      if (position.liquidity === '0') {
        networkData.closedPositionNum += 1;
        networkData.closedPositionTotalPnLAbs += Math.abs(
          Number(position.performance.hodl.pnl),
        );
      } else {
        networkData.openPositionNum += 1;
        networkData.openPositionTotalValue += Number(position.underlying_value);
      }
    }
    data = `${data},${networkData.openPositionNum},${networkData.openPositionTotalValue},${networkData.closedPositionNum},${networkData.closedPositionTotalPnLAbs}`;
  }
  data = data.slice(1);
  console.log(data);
  return data;
}

async function readUserInfoFromCsvFile(filePath: string) {
  const START = 5259;
  const SIZE = 1000;
  const fileContent = readFileSync(filePath, 'utf8');
  const lines = fileContent.split('\n');
  for (const line of lines.slice(1).slice(START, START + SIZE)) {
    const rawAddr = line.split(',').slice(-3)[0];
    const newLine = `${line.slice(
      0,
      -1,
    )},${await fetchUserInfoFromRevertFinance(rawAddr)}`;
    appendFileSync('output.csv', newLine + '\n');
  }
  console.log(
    `Failed to fetch data from Revert Finance ${fetchFailureCount} times.`,
  );
  console.log(`Invalid address count: ${invalidAddressCount}`);
}

readUserInfoFromCsvFile('input.csv');
