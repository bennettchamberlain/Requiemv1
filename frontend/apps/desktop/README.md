# CI-Server Desktop (macOS / Windows / Linux)

A native desktop app (Tauri) that brings up CI-Server's own Docker Compose
stack **locally** and shows it — a local orchestrator, not a thin client.

This is architecturally different from [`frontend/apps/ios`](../ios) and
[`frontend/apps/android`](../android): those wrap the built web app and point
it at a **remote**, already-running CI-Server appliance. This app manages its
**own local** backend: it starts CI-Server's containers on your machine, waits
for them to become healthy, then shows the real web UI.

## How it works

1. On launch, the app copies its bundled compose files
   (`docker-compose.yml`, `docker-compose.production.yml`, and a desktop-only
   overlay, `docker-compose.desktop.yml`) into an OS-appropriate app-data
   directory, and writes a `.env` alongside them (no secrets — see below).
2. It runs `docker compose --profile production up -d` against those files.
3. A splash page (`bootstrap/`) polls a Rust-backed health check
   (`gateway`'s `/api/health`, which proxies to `api`'s own health endpoint)
   every second.
4. Once healthy, the window navigates (`window.location.replace()`) to
   `http://127.0.0.1:8642/` — from that point on it's the real CI-Server web
   app, served by the `gateway` container, on a normal same-origin browser
   session (standard cookie auth — no CORS/CSRF wiring needed for this app).
5. A tray icon lets you show/hide the window, manually start/stop the stack,
   and view the desktop log, without quitting.

Images are pulled from `ghcr.io/companionintelligence/companion/*` (see
`../../../scripts/publish/images.sh`) at a version tag resolved at build time
by `scripts/sync-compose-resources.cjs` — **never `:latest`** (a stale
`companion/*:latest` tag orphaned once before; see that script's comments).

**No secrets are generated or touched by this app.** `generate-secrets`
(`ci/setup-secrets` → `companion/setup-secrets`) creates every auth/DB secret
into a Docker-managed volume on first boot, exactly as it does for
`make production` — see `../../../infrastructure/setup-secrets/entrypoint.sh`.

## Setup

Prerequisites:

- [Rust](https://rustup.rs) (stable)
- [Docker](https://www.docker.com/products/docker-desktop/) (Compose CLI ≥
  2.24 — see the note on `!reset` below)
- Platform Tauri build dependencies:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux** (Ubuntu/Debian): `build-essential pkg-config curl wget file
    libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev
    libayatana-appindicator3-dev librsvg2-dev patchelf`, plus `rpm` and
    `libfuse2`/`xdg-utils` if you also want to build/run an AppImage locally
  - **Windows**: WebView2 Runtime (preinstalled on modern Windows), Visual
    Studio Build Tools ("Desktop development with C++")

```bash
cd frontend/apps/desktop
yarn install    # installs @tauri-apps/cli only — this is a standalone project,
                # not part of the root Yarn workspace; see .yarnrc.yml
```

## Run in development

```bash
yarn dev
```

This syncs the compose resources (`scripts/sync-compose-resources.cjs`) —
which resolves `CI_SERVER_IMAGE_TAG` from your current git checkout the same
way `scripts/publish/publish.sh` does — then runs `cargo tauri dev`. That
resolved tag must actually exist under
`ghcr.io/companionintelligence/companion/*`; if you're not on a published
release tag, export one explicitly:

```bash
CI_SERVER_IMAGE_TAG=<a tag publish.yml has pushed> yarn dev
```

Docker must be running (`docker info` should succeed) before launch.

## Build

```bash
yarn build
```

Produces the platform's native bundle(s) via `cargo tauri build` (dmg/app on
macOS, msi/nsis on Windows, deb/rpm on Linux locally — AppImage is added only
in CI where `linuxdeploy` is installed, via `-b deb,rpm,appimage`).

## A note on the `!reset` compose tag

`docker-compose.desktop.yml` uses the Compose Specification's `!reset` tag to
clear `hbpe-service`'s ROCm device passthrough (`devices`, `group_add`) that
`docker-compose.production.yml` unconditionally adds — Compose merges
list-valued keys across `-f` files by *concatenation*, so a plain override
can't remove them, and without `!reset` the stack would hard-fail
(`docker compose up`) on any machine that isn't an AMD ROCm box. This needs
Docker Compose CLI ≥ 2.24. If `docker compose up` fails with a parse error on
`!reset`, upgrade Docker/Compose.

## Deferred for v1

The following exist in CI-Hub's own Tauri desktop app
(`CI-Hub/packages/desktop`) but are deliberately **not** implemented here yet.
Not silently missing — just out of scope for this first pass:

- Docker / Ollama / GPU-driver **auto-installers** — this app detects Docker's
  absence and links to the download page; it doesn't install anything for you.
- GPU host-hardware auto-detection or Docker Desktop VM resource tuning.
- GPU-variant (CUDA/ROCm) image selection — always pulls the CPU-built
  `hbpe-service` image, with GPU device passthrough explicitly disabled (see
  above).
- A custom self-updater / in-app auto-update. Reinstall from a new release to
  upgrade.
- A watchdog that auto-restarts a crashed stack — the tray shows live status
  and offers manual Start/Stop only.
- mDNS discovery of other appliances on the LAN (not applicable — this app
  only ever manages its own local stack).
- A deep-link URL scheme / pairing flow (not applicable, for the same reason).
- Sentry crash reporting for the desktop shell itself.
- ARM Linux and Windows-ARM build legs (`desktop-build.yml`/
  `desktop-release.yml` currently build x86_64 Linux/Windows and both macOS
  architectures only).
- Persisted window geometry across relaunches.

## CI

- **`desktop-build.yml`** — `workflow_dispatch` only, unsigned. Produces
  downloadable dmg/deb/rpm/appimage/msi artifacts for verification.
- **`desktop-release.yml`** — tag-triggered (`desktop-v*`) + dispatch, signed.
  The macOS and Windows lanes **skip (not fail)** until Apple/Windows signing
  secrets are provisioned — see that workflow's header comment for the exact
  secret names needed. The Linux lane always runs unsigned (no signing
  convention exists for `.deb`/`.rpm` in this repo).
