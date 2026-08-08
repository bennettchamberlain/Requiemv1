import eslintShared from './eslint.shared.mjs';

export default [
  {
    ignores: [
      '.yarn',
      '**/dist/**',
      '**/node_modules/**',
      '.pnp.*',
      // Nested git worktrees are full copies of this repo. ESLint does not read
      // .gitignore, so without this it walks them and re-lints every file with
      // the root config instead of the per-workspace ones.
      '.claude/worktrees/**',
      // Same reason: the uv workspace's virtualenv. Several Python packages
      // ship browser JS inside site-packages (torch and scikit-learn both do),
      // and linting a vendored bundle with this repo's rules is meaningless.
      '**/.venv/**',
      'backend/apps/api/*',
      'frontend/apps/web/*',
      'infrastructure/iframely/**',
    ],
  },

  ...eslintShared,
];
