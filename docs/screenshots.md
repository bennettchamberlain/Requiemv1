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
   the image from the relevant doc with a path relative to that doc — e.g. from
   the root `README.md`:

   ```markdown
   ![Memory graph view](docs/images/memory-graph.png)
   ```

   …or from another file under `docs/`:

   ```markdown
   ![Memory graph view](images/memory-graph.png)
   ```

## Conventions

- **Use the seeded demo data only.** Never capture a screen containing real
  personal data, secrets, tokens, or `.env` values — this repo is private and
  confidential.
- Scrub anything sensitive (API keys, OAuth tokens, email addresses other than
  the demo user) before committing.
- Keep files reasonably sized (prefer < 500 KB; compress large PNGs).
- One screen per file; name by the screen, not by the route.

## Where the screens are

Routes are from `frontend/apps/web` (`App.tsx`); the navigation these tables
follow is `layouts/Main/railDestinations.ts` (the **Power Rail** — there are no
breadcrumbs any more) and `components/MemoryHub/memoryHubSections.ts` (the
Memory hub tabs).

- The **Power Rail** has nine destinations, top to bottom: Plan, Today,
  Forecast, Memory, Saved Searches, Chat, Sources, Jobs, Stats.
- **Memory is a hub**, not a single screen: `/memory/*` holds eight sibling
  sections (Events, People, Places, Things, Receipts, Content, Tags,
  Reflections). The Explorer is the Events section at `/memory/events`.
- A pile of older addresses are now **redirects** and should never be the route
  in a capture note: `/memory` → `/memory/events`, `/feed`, `/brief`,
  `/schedule`, `/insights` → `/today`, `/files` → `/memory/content`,
  `/inventory` → `/memory/things`, `/tags` → `/memory/tags`, `/prompts` and
  `/memory/questions` → `/memory/reflections`, `/people` → `/memory/people`,
  `/places` → `/memory/places`, `/connect`, `/connections` →
  `/sources/connect`, `/import` → `/sources/import`, `/memory/knowledge` →
  `/memory/events?view=graph`.

## Screens to capture

Items are unchecked until the screenshot exists in `docs/images/` and is wired
into a doc. Rows marked with a flag only exist when that feature flag is on;
all of the ones listed default to `true` in
`backend/apps/api/config/default.json`.

| Screen | Route | Suggested file | What it should show |
|---|---|---|---|
| Login | `/login` | `login.png` | OIDC-primary login screen (the default landing for a logged-out user) |
| Onboarding | `/onboarding` | `onboarding.png` | First-run focus-areas / preferences flow |
| Today | `/today` | `today.png` | The home surface — Schedule stacked above the Brief |
| Summary detail | `/brief/summaries/:id` | `summary-detail.png` | A single generated summary opened from Today |
| Forecast | `/forecast` | `forecast.png` | HBPE forecast strip, week ahead, divergence heatmap, calibration |
| Plan | `/plan` | `plan.png` | Task list + triage inbox (planning domain; flag `planning.page`) |
| Memory · Explorer (List) | `/memory/events` | `memory-list.png` | Default Explorer view — List, with the What bar and filter chips |
| Memory · Explorer (Gallery) | `/memory/events?view=gallery` | `memory-gallery.png` | Media grid with thumbnails |
| Memory · Explorer (Map) | `/memory/events?view=map` | `memory-map.png` | Located events on the map, with the timeline strip |
| Memory · Explorer (Graph) | `/memory/events?view=graph` | `memory-graph.png` | Force-graph view of entities & relationships |
| Memory · People | `/memory/people` | `people.png` | People browse + merge-candidate review queue |
| Memory · Places | `/memory/places` | `places.png` | Places browse |
| Memory · Things | `/memory/things` | `things.png` | Owned items (formerly "Inventory"), incl. the sightings review queue |
| Memory · Receipts | `/memory/receipts` | `receipts.png` | Receipts browse |
| Memory · Content | `/memory/content` | `content.png` | Files/content browse and the file viewer (flag `files.page`) |
| Memory · Tags | `/memory/tags` | `tags.png` | Tag list with rename/delete (flag `tags.page`) |
| Memory · Reflections | `/memory/reflections` | `reflections.png` | Reflection catalogue (formerly "Questions"; flag `insights.page`) |
| Saved searches | `/saved-searches` | `saved-searches.png` | Saved-search rows with the Shared badge and the active filter dimensions |
| Shared search viewer | `/shared/:token` | `shared-search.png` | Read-only shared explorer (see [saved-search-sharing.md](saved-search-sharing.md)) |
| Asks | `/asks` | `images/asks/*.png` ✅ | **Captured** — all six tabs plus a light-theme shot, wired into [asks-system-guide.md](asks-system-guide.md) §8. Kept in their own `images/asks/` folder because it is a set, not one screen, and captured in **dark** theme (the surface's own default) rather than the light default this guide otherwise asks for (flag `ask`) |
| Search | `/search` | `search.png` | Standalone query box with ranked results |
| Chat / Ask | `/chat` | `chat.png` | "Ask my memory" conversation surface (flag `chat.page`) |
| Sources · Connect | `/sources/connect` | `sources-connect.png` | Connected accounts above the 17-service catalogue (Google, Microsoft, Meta, Spotify, Steam, GitHub, …; 8 of the 17 render as "coming soon") |
| Sources · Import | `/sources/import` | `sources-import.png` | Native import run kickoff + stage progress (flag `import.page` — with it off the route still resolves but redirects to `/sources/connect`) |
| Sources · Devices | `/sources/devices` | `sources-devices.png` | Registered devices, plus the browser-extension (Chrome/Firefox/Safari) and Companion Capture (macOS/Windows/Linux) galleries |
| Connection detail | `/connections/:id` | `connection.png` | One connection: sync state, scopes, history |
| Jobs | `/jobs` | `jobs.png` | Job dashboard, filterable list, history charts, dead letters (flag `jobs.page`) |
| Stats | `/stats` | `stats.png` | "Life stats" — entities by type and by tag (flag `stats.page`) |
| Notes | `/notes` | `notes.png` | Notes list + editor |
| Settings | `/settings` | `settings.png` | Settings (appearance, API keys, OAuth) |
| System | `/system` | `system.png` | System / health view |
| Device connect | `/device-connect` | `device-connect.png` | Native first-launch Portal sign-in + Memory Server picker (`/server` is the Advanced URL fallback) |

## Existing visuals

- The root README's **Hermes setup** images are hosted as GitHub
  user-attachments (uploaded via the GitHub UI), not committed files.
- Architecture, data-model, and data-flow diagrams live in
  [docs/architecture/architecture.md](architecture/architecture.md) and the root
  README as **Mermaid** diagrams, which GitHub renders inline — no image files
  required. Prefer Mermaid for anything structural (it stays in sync with the
  text and diffs cleanly); use captured PNGs for actual UI.
