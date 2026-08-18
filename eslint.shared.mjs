import * as tseslint from 'typescript-eslint';

import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import 'eslint-import-resolver-typescript';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Disables formatting-related ESLint rules; Prettier runs as its own pipeline step now.
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
      '@typescript-eslint': tseslint.plugin,
    },

    rules: {
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

      'import/no-duplicates': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          disallowTypeAnnotations: false,
        },
      ],

      // `ignoreRestSiblings` tolerates the standard "destructure to exclude a
      // key" idiom — `const { thatKey: _unused, ...rest } = obj` — which is not
      // a real unused variable, it's how you drop a field before using the
      // rest. Off by default in @typescript-eslint's recommended preset; this
      // codebase already uses the pattern (TaskService.ts, TodoProcessService.ts)
      // and was one preset version bump away from every instance of it failing
      // lint.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
];
