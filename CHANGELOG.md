# Changelog

All notable changes to Companion Memory (CI-Server) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — Design system

- **Canonical CI teal primary.** Re-keyed the web token set to the Companion
  Intelligence canonical palette: `--primary` is now CI teal in both modes
  (light `#0f717a` / dark `#abd4d8`), applied across `frontend/apps/web`
  (`src/styles/index.css`) and the shared shadcn package
  (`frontend/packages/shadcn/src/styles/globals.css`).
- **Montserrat typography.** Adopted Montserrat as the UI sans stack — wired via
  the web app `index.html` font link, `tailwind.config.mjs` (`font-sans`), and
  the heading font-family in `src/styles/index.css`.
- **Enriched design tokens (v0.2.0).** Expanded the token set beyond the base
  shadcn variables: a full teal ramp (`--teal-50`…`--teal-950`), aqua/mint brand
  accents (`--aqua`, `--aqua-light`, `--mint`, `--teal-mid`), semantic status
  colors (`--success` / `--warning` / `--info`, each with a `-foreground`),
  brand gradients (`--gradient-brand`, `--gradient-hero`, `--gradient-aurora`,
  plus the `--ci-primary-gradient` primary surface), a radius scale
  (`--radius-sm` … `--radius-2xl`), and a shadow/elevation scale
  (`--shadow-sm/md/lg`, `--shadow-glow-ci`) with light and dark values.
  Aligned with the CI-Hub canonical style guide / `@companionintelligence/tokens`
  as the source of truth.
- **Primary surface on the default button.** The default Button variant renders
  the CI primary gradient surface (`ci-primary-surface`) rather than a flat fill.

### Added — Design system

- **Design-canon lint gate.** Added `scripts/lint-canon.mjs` (zero-dependency,
  Node built-ins only) and the `Style canon lint` GitHub Actions workflow
  (`.github/workflows/style-canon-lint.yml`), which fails CI if any resolvable
  `--primary` value is not CI teal in any color notation (hex, rgb, hsl, bare
  hsl-triplet, oklch, oklab) and warns on hardcoded hex in component source.
- **Theme/token test coverage.** Added token/theme tests
  (`frontend/apps/web/src/components/ThemePicker/themeTokens.test.tsx`,
  `frontend/apps/web/src/components/Button.test.tsx`) covering the canonical
  palette and the primary-surface button.
- **Style-audit board.** Added a before/after design reference at
  `docs/style-audit/CI-Server-before-after.png`.
