export default {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  transform: {
    '^.+\\.[tj]s$': ['@swc/jest'],
  },

  transformIgnorePatterns: ['/.pnp.cjs$', 'node_modules/(?!(p-limit|yocto-queue)/)'],

  moduleNameMapper: {
    '^@ci/(.*)$': '<rootDir>/src/$1',
  },

  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],

  setupFilesAfterEnv: ['reflect-metadata'],
};
