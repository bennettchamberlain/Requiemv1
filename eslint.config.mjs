import js from '@eslint/js';
import * as tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['.yarn', 'dist', 'node_modules', '**/__generated__/**', '.pnp.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.ts', '**/*.tsx', 'eslint.config.mjs'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: globals.node,
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['backend/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './backend/tsconfig.json',
        tsconfigRootDir: new URL('.', import.meta.url),
      },
      globals: globals.node,
    },
  },
  {
    files: ['frontend/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './frontend/tsconfig.json',
        tsconfigRootDir: new URL('.', import.meta.url),
      },
      globals: globals.browser,
    },
  },
];
