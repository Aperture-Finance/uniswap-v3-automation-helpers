import axios from 'axios';

// TODO: Add pagination params.
// TODO: Add code to parse the response.
/**
 * Fetches wallet activities for the specified address. Activities include ERC-20 and NFT token transfers, approvals, and Uniswap trades and liquidity management.
 * @param address The wallet address to fetch activities for.
 */
export async function getWalletActivities(address: string) {
  console.log(
    (
      await axios.post(
        'https://uniswap-api-graphql.hyperfocal-dev.workers.dev/v1/graphql',
        {
          operationName: 'TransactionList',
          variables: {
            account: address,
          },
          query: `
            query TransactionList($account: String!) {
                portfolios(ownerAddresses: [$account]) {
                  id
                  assetActivities(pageSize: 50, page: 1) {
                    ...AssetActivityParts
                    __typename
                  }
                  __typename
                }
              }
              
              fragment AssetActivityParts on AssetActivity {
                id
                timestamp
                type
                chain
                transaction {
                  ...TransactionParts
                  __typename
                }
                assetChanges {
                  __typename
                  ... on TokenTransfer {
                    ...TokenTransferParts
                    __typename
                  }
                  ... on NftTransfer {
                    ...NFTTransferParts
                    __typename
                  }
                  ... on TokenApproval {
                    ...TokenApprovalParts
                    __typename
                  }
                  ... on NftApproval {
                    ...NFTApprovalParts
                    __typename
                  }
                  ... on NftApproveForAll {
                    ...NFTApproveForAllParts
                    __typename
                  }
                }
                __typename
              }
              
              fragment TransactionParts on Transaction {
                id
                blockNumber
                hash
                status
                to
                from
                __typename
              }
              
              fragment TokenTransferParts on TokenTransfer {
                id
                asset {
                  ...TokenAssetParts
                  __typename
                }
                tokenStandard
                quantity
                sender
                recipient
                direction
                transactedValue {
                  id
                  currency
                  value
                  __typename
                }
                __typename
              }
              
              fragment TokenAssetParts on Token {
                id
                name
                symbol
                address
                decimals
                chain
                standard
                project {
                  id
                  isSpam
                  logo {
                    id
                    url
                    __typename
                  }
                  __typename
                }
                __typename
              }
              
              fragment NFTTransferParts on NftTransfer {
                id
                asset {
                  ...NFTAssetParts
                  __typename
                }
                nftStandard
                sender
                recipient
                direction
                __typename
              }
              
              fragment NFTAssetParts on NftAsset {
                id
                name
                nftContract {
                  id
                  chain
                  address
                  __typename
                }
                tokenId
                image {
                  id
                  url
                  __typename
                }
                collection {
                  id
                  name
                  __typename
                }
                __typename
              }
              
              fragment TokenApprovalParts on TokenApproval {
                id
                asset {
                  ...TokenAssetParts
                  __typename
                }
                tokenStandard
                approvedAddress
                quantity
                __typename
              }
              
              fragment NFTApprovalParts on NftApproval {
                id
                asset {
                  ...NFTAssetParts
                  __typename
                }
                nftStandard
                approvedAddress
                __typename
              }
              
              fragment NFTApproveForAllParts on NftApproveForAll {
                id
                asset {
                  ...NFTAssetParts
                  __typename
                }
                nftStandard
                operatorAddress
                approved
                __typename
              }
            `,
        },
      )
    ).data.data.portfolios,
  );
}

getWalletActivities('0x8B18687Ed4e32A5E1a3DeE91C08f706C196bb9C5');
