/* eslint-env node */

import type { CodegenConfig } from '@graphql-codegen/cli';

// Generates TS objects from the schemas returned by graphql queries
// To learn more: https://www.apollographql.com/docs/react/development-testing/static-typing/#setting-up-your-project
const config: CodegenConfig = {
  overwrite: true,
  schema: 'data/uniswap-thegraph-schema.graphql',
  documents: ['data/uniswap-thegraph-document.graphql'],
  generates: {
    'data/__graphql_generated__/uniswap-thegraph-types-and-hooks.ts': {
      plugins: ['typescript', 'typescript-operations'],
      config: {
        withHooks: true,
        // This avoid all generated schemas being wrapped in Maybe https://the-guild.dev/graphql/codegen/plugins/typescript/typescript#maybevalue-string-default-value-t--null
        maybeValue: 'T',
      },
    },
  },
};

export default config;
