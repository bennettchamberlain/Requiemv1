import eslintShared from './eslint.shared.mjs';

export default [
  {
    ignores: [
      '.yarn',
      '**/dist/**',
      // Prettier and oxlint both ignore build output generally; ESLint only
      // listed dist plus specific native build dirs, so bundled vendor JS
      // under other build/ trees still got linted with this repo's rules.
      '**/build/**',
      '**/node_modules/**',
      '.pnp.*',
      // Nested git worktrees are full copies of this repo. ESLint does not read
      // .gitignore, so without this it walks them and re-lints every file with
      // the root config instead of the per-workspace ones.
      '.claude/worktrees/**',
      '.worktrees/**',
      // Same reason: the uv workspace's virtualenv. Several Python packages
      // ship browser JS inside site-packages (torch and scikit-learn both do),
      // and linting a vendored bundle with this repo's rules is meaningless.
      '**/.venv/**',
      // Capacitor-generated native output. `cap sync` copies the minified
      // @ci/fe-web bundle into frontend/apps/ios and frontend/apps/android, and the
      // native builds copy it again into their product dirs. Linting ~95
      // minified chunks per platform buries the real output under six figures
      // of errors in code we did not write. oxlint skips them on its own (it
      // reads frontend/apps/ios/.gitignore / android/.gitignore); ESLint reads no .gitignore, so
      // it needs the paths spelled out. Keep in sync with .prettierignore.
      'frontend/apps/ios/ios/App/App/public/**',
      'frontend/apps/ios/ios/App/Pods/**',
      'frontend/apps/ios/ios/App/build/**',
      'frontend/apps/ios/ios/App/DerivedData/**',
      'frontend/apps/ios/ios/DerivedData/**',
      'frontend/apps/ios/ios/capacitor-cordova-ios-plugins/**',
      'frontend/apps/android/android/app/src/main/assets/public/**',
      'frontend/apps/android/android/app/build/**',
      'frontend/apps/android/android/build/**',
      'frontend/apps/android/android/capacitor-cordova-android-plugins/**',
      'backend/apps/api/*',
      'frontend/apps/web/*',
      'infrastructure/iframely/**',
    ],
  },

  ...eslintShared,
];
