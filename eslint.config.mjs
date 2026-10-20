import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'docs/openapi/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  ...pluginVue.configs['flat/recommended'],
  prettier,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: ['**/*.vue'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    files: [
      'apps/backend/src/http/**/*.ts',
      'apps/backend/src/telegram/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^@avito/(?:database|integrations|queue)(?:/|$)|(?:^|/)(?:infrastructure|bootstrap|jobs)(?:/|$)',
              message:
                'HTTP and Telegram adapters call domain scenarios; concrete persistence is wired in bootstrap.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/backend/src/jobs/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^@avito/(?:database|integrations)(?:/|$)|(?:^|/)(?:infrastructure|bootstrap|http|telegram)(?:/|$)',
              message:
                'Queue adapters call domain scenarios; concrete persistence is wired in bootstrap.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/backend/src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(?:^|/)(?:bootstrap|cli|dev|http|jobs|telegram)(?:/|$)',
              message:
                'Infrastructure implements domain dependency contracts and must not depend on inbound adapters or bootstrap.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(?:node:[^/]+|@avito/(?:domain|database|integrations|queue|observability|contracts)|fastify|@fastify/[^/]+|telegraf|bullmq|drizzle-orm|pg|ioredis|dotenv|pino)(?:/|$)|(?:^|/)apps/',
              message:
                'Domain scenarios and rules use injected dependencies and relative internal imports, never concrete runtimes, providers, SQL or transport.',
            },
          ],
        },
      ],
    },
  },
);
