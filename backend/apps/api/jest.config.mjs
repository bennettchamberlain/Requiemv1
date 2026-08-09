export default {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  transform: {
    '^.+\\.[tj]s$': ['@swc/jest'],
  },

  transformIgnorePatterns: [
    // Ignore .yarn/cache packages EXCEPT ESM-only ones that require transformation
    '\\.yarn/cache/(?!(p-limit|yocto-queue|parse-duration)-npm-)',
    '\\.pnp\\.cjs$',
  ],

  moduleNameMapper: {
    '^@ci/(.*)$': '<rootDir>/src/$1',
  },

  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  coverageDirectory: '<rootDir>/coverage',
  collectCoverageFrom: ['<rootDir>/src/**/*.ts'],

  // Ratchet, per docs/architecture/test-strategy.md §4: a floor that only ever
  // moves up. Scoped rather than global because the global number is still low;
  // new domains land with a real floor from day one instead of inheriting it.
  //
  // The planning floor is set just under what the suite achieves WITHOUT a
  // database, since TaskService.tenancy.integration.test.ts skips unless
  // PLANNING_TEST_DATABASE_URL is set.
  coverageThreshold: {
    './src/domains/planning/': {
      statements: 88,
      branches: 76,
      functions: 76,
      lines: 90,
    },
  },

  setupFilesAfterEnv: ['reflect-metadata'],
};
