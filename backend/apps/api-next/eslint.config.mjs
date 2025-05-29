import base from '../../../eslint.config.mjs';
import globals from 'globals';

export default [
  ...base,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: new URL('.', import.meta.url),
      },
      globals: globals.node,
    },
  },
];
