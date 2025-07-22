import * as tseslint from 'typescript-eslint';

import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['.yarn', '**/dist/**', '**/node_modules/**', '.pnp.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: globals.node,
    },
    plugins: {
      import: importPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', ['sibling', 'index']],
          pathGroups: [
            {
              pattern: '@ci/**',
              group: 'internal',
              position: 'after',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin', 'external'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      'prettier/prettier': 'error',

      curly: ['error', 'all'],

      'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: false }],

      'padding-line-between-statements': [
        'error',
        // Require blank line after all blocks (if, for, while, try, etc.)
        { blankLine: 'always', prev: ['block', 'block-like'], next: '*' },
        // Disallow blank line before else/catch/finally
        { blankLine: 'never', prev: 'block', next: 'block-like' },
        // Require blank line before return statements
        { blankLine: 'always', prev: '*', next: 'return' },
        // Between function declarations
        { blankLine: 'always', prev: 'function', next: 'function' },
        // Between class declarations
        { blankLine: 'always', prev: 'class', next: 'class' },
      ],
    },
  },
];
