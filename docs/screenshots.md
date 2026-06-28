# Screenshots & visual documentation

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**

This guide tracks the UI screenshots we want in the docs and how to capture them
consistently. Screenshots can only be taken against a **running** stack, so they
are produced manually (not in CI) and committed under `docs/images/`.

## How to capture

1. Bring the stack up and seed demo data (see the [root README](../README.md)):

   ```bash
   make dev      # in one shell — starts the full stack at https://<project>.localhost
   make seed     # in another shell — loads the John Smith demo user + data
   ```

2. Open `https://<project>.localhost` (e.g. `https://ci-server.localhost`) and log
   in with the seeded demo account. The credentials are in the root README's
   [Seed and log in](../README.md#seed-and-log-in) section.

3. Capture at a consistent viewport (**1440×900**, light theme unless the shot is
   specifically demonstrating dark mode) and export as PNG.

4. Save to `docs/images/` using the file names in the table below, then reference
   the image from the relevant doc, e.g.:

   ```markdown
   ![Memory graph view](docs/images/memory-graph.png)
   ```

## Conventions

- **Use the seeded demo data only.** Never capture a screen containing real
  personal data, secrets, tokens, or `.env` values — this repo is private and
  confidential.
- Scrub anything sensitive (API keys, OAuth tokens, email addresses other than
  the demo user) before committing.
- Keep files reasonably sized (prefer < 500 KB; compress large PNGs).
- One screen per file; name by the screen, not by the route.

## Screens to capture

Routes are from `frontend/apps/web` (`App.tsx`). Items are unchecked until the
screenshot exists in `docs/images/` and is wired into a doc.

| Screen | Route | Suggested file | What it should show |
|---|---|---|---|
| Login | `/login` | `login.png` | OIDC-primary login screen (the default landing for a logged-out user) |
| Onboarding | `/onboarding` | `onboarding.png` | First-run focus-areas / preferences flow |
| Memory | `/memory` | `memory-list.png` | Default memory view (List) of entities |
| Memory graph | `/memory` | `memory-graph.png` | 3D force-graph view of entities & relationships |
| Search | `/search` | `search.png` | Query box with ranked results |
| Chat / Ask | `/chat` | `chat.png` | "Ask my memory" conversation surface |
| Feed | `/feed` | `feed.png` | Activity / import feed with progress |
| Insights | `/insights` | `insights.png` | HBPE-derived insights / predictions |
| Connections | `/connections` | `connections.png` | Connected providers (Google, Microsoft, Facebook, Spotify) |
| Connect | `/connect` | `connect.png` | Add-a-connection / OAuth start |
| Files | `/files` | `files.png` | Uploaded files and document pipeline |
| Inventory | `/inventory` | `inventory.png` | Inventory of items |
| Notes | `/notes` | `notes.png` | Notes list + editor |
| Jobs | `/jobs` | `jobs.png` | Background job / queue status |
| Settings | `/settings` | `settings.png` | Settings (appearance, API keys, OAuth) |
| System | `/system` | `system.png` | System / health view |

## Existing visuals

- The root README's **Hermes setup** images are hosted as GitHub
  user-attachments (uploaded via the GitHub UI), not committed files.
- Architecture, data-model, and data-flow diagrams live in
  [docs/architecture/architecture.md](architecture/architecture.md) and the root
  README as **Mermaid** diagrams, which GitHub renders inline — no image files
  required. Prefer Mermaid for anything structural (it stays in sync with the
  text and diffs cleanly); use captured PNGs for actual UI.
