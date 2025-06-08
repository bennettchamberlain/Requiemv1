import base from '../../../eslint.config.mjs';
import globals from 'globals';

export default [
  ...base,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: new URL('.', import.meta.url),
      },
      globals: globals.browser,
    },
  },
];
