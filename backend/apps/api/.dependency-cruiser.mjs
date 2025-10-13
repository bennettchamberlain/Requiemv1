export default {
  options: {
    tsPreCompilationDeps: true,

    tsConfig: {
      fileName: 'tsconfig.json',
    },

    doNotFollow: {
      path: 'node_modules',
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
    },
  },

  forbidden: [
    {
      name: 'no-cross-domain-internals',
      severity: 'error',
      comment: 'Only import another domain via its public barrel; do not reach into its internals.',
      from: {
        path: '^src/domains/([^/]+)/',
      },
      to: {
        path: '^src/domains/',
        pathNot: ['^src/domains/$1/', '^src/domains/[^/]+/index\\.ts$'],
      },
    },
  ],
};
