/**
 * Capture stage for Companion Memory (CI-Server).
 *
 * The stage is the repo's OWN full-stack e2e stack, not a second invention:
 *
 *   yarn e2e            # playwright.e2e.config.ts webServer boots
 *                       #   @ci/be-api  on :3030
 *                       #   @ci/fe-web  on :5173 (Vite proxies /api -> :3030)
 *
 * Playwright's `webServer` only boots those two node processes. The database
 * underneath has to already exist, be migrated and be seeded — see
 * .github/workflows/e2e.yml, which is the authoritative recipe:
 *
 *   cp .env.default .env
 *   make distribute-license
 *   docker build -f infrastructure/database/Dockerfile       -t ci/database:latest       infrastructure/database
 *   docker build -f infrastructure/setup-database/Dockerfile -t ci/setup-database:latest infrastructure/setup-database
 *   docker compose -f docker-compose.yml -f docker-compose.local.yml --profile local up -d database setup-database
 *   yarn workspace @ci/be-api migrate                    # ~147 dbmate migrations
 *   cd backend/apps/api && yarn run exec -- scripts/seed-database/main.ts
 *
 * WITHOUT THE SEED EVERY SCREEN IN THIS STORYBOARD IS AN EMPTY STATE.
 *
 * ── Authentication ───────────────────────────────────────────────────────────
 * Every interesting route is behind `ProtectedRoute`, so the capture context is
 * pre-authenticated here over HTTP using exactly the flow in
 * tests/e2e/global-setup.ts: GET /api/authenticate/csrf to mint the csrfToken
 * cookie, then POST /api/authenticate with the X-CSRF-Token header. Doing it in
 * `onContext` (rather than pointing `storageState` at playwright/.auth/user.json)
 * means capture does not depend on a prior `yarn e2e` run having left a fresh
 * state file behind.
 *
 * TWO-PASS CAPTURE. `ci-video capture` creates ONE browser context per viewport
 * and shares it across every shot, so a single run is either logged in or logged
 * out — it cannot be both. Two shots in this storyboard are deliberately
 * logged-out (`splash-screen`, `login-form`): `/` and `/login` are both wrapped
 * in RedirectKnownUser, which sends an authenticated, onboarded user straight to
 * /feed. Capture them in a second pass with auth disabled:
 *
 *   npm run capture                                                   # authenticated, all shots
 *   VIDEO_LOGGED_OUT=1 npm run capture -- --only splash-screen,login-form
 *
 * Run them in that order — the second pass overwrites the two logged-out PNGs
 * that the first pass captured as /feed redirects.
 *
 * ── Determinism hazards found in this repo ───────────────────────────────────
 * 1. SEED DATE-SHIFT (worst offender).
 *    backend/apps/api/scripts/seed-database/main.ts:159-168 rebases the ENTIRE
 *    seed corpus so its newest record lands "yesterday" relative to the wall
 *    clock at seed time. Re-seed on a different day and every date, date-group
 *    header and timeline bucket in the app moves. Capture cannot fix this; it is
 *    a property of the fixture. Seed and capture in the same job.
 * 2. FROZEN CLOCK vs THAT SHIFT — `fixedTime` is OFF here on purpose.
 *    video-kit freezes the browser clock with Playwright's `clock.install()`.
 *    Because the seed is rebased onto real "now", pinning the browser to a fixed
 *    past instant would render every seeded record in the future ("in 48 days").
 *    `clock.install()` also fakes setTimeout/setInterval/requestAnimationFrame,
 *    which would freeze the onboarding Intro typewriter
 *    (pages/OnboardingPage/Intro.tsx) after one character, stall the search
 *    debounce (ExplorerToolbar.tsx:983) and stop the force-graph simulation
 *    mid-settle. Residual clock volatility is handled by masking `<time>`
 *    instead. Override with VIDEO_FIXED_TIME=<iso> if you ever seed against a
 *    pinned clock.
 * 3. RELATIVE / ABSOLUTE TIMES — every list row renders a `<time>` from
 *    formatRowTime (MemoryPage/Components/utils.tsx:337), which switches between
 *    "3:42 PM", "Jun 14" and "Jun 14, 2025" depending on today. Masked.
 * 4. HBPE FORECAST STRIP — the feed's `role="img"` strip
 *    (components/ForecastStrip/ForecastStrip.tsx:288) plots per-bucket
 *    probabilities from the behavioural model. Masked.
 * 5. ACTIVITY TIMELINE RAIL — NOT masked, and the known residual drift.
 *    MemoryPage/ActivityTimelineRail.tsx bounds its grid on today's local day
 *    key and colours each cell by per-day counts, so it moves whenever the seed
 *    moves. It has no stable hook to mask (no id/testid/aria-label on its root)
 *    and blanking it would punch a black column through the hero shot. Masking
 *    it needs a one-line app change (a `data-testid` on the rail root) that is
 *    out of scope for this PR. Until then, expect the weekly workflow to open a
 *    drift PR after any re-seed.
 * 6. LEAFLET / ARCGIS TILES — components/Map/Map.tsx:35 loads raster tiles from
 *    server.arcgisonline.com. That is live external network: an offline runner
 *    renders an empty pane, and tile revisions change the bytes. The attribution
 *    control is masked; the tiles themselves cannot be.
 * 7. LAZY THUMBNAILS — GalleryView tiles use `loading="lazy"`
 *    (GalleryView/MediaTile.tsx) and their sources come from MinIO on :9000 via
 *    the /static proxy. With MinIO down the gallery degrades to file glyphs,
 *    which reads as a UI regression but is a missing service.
 * 8. FEATURE FLAGS decide which routes even exist.
 *    backend/apps/api/config/default.json:131-149 ships chat.page=false,
 *    files.page=false, jobs.page=false, stats.page=false — with the stock
 *    .env.default those routes render NotFound, so nothing here films them.
 *    insights.page / new.insights.page / tags.page / hbpe are on.
 * 9. RESPONSIVE SPLIT — /memory renders DesktopMemoryPage above 768px and
 *    MobileMemoryPage below (packages/common useDeviceLayout, MOBILE_BREAKPOINT
 *    768), and capture films 1280px AND 360px with the SAME selectors. The
 *    desktop breadcrumb view-switcher (`aria-label="List view — change view"`,
 *    DesktopMemoryPage.tsx:293) does not exist on mobile, so no waitFor here
 *    uses it — every selector was chosen to resolve at both widths.
 */

const BASE_URL = process.env.APP_URL ?? 'http://localhost:5173';

// Matches .env.default / .github/workflows/e2e.yml. Throwaway dev credentials
// for an ephemeral, seeded database — not a secret.
const EMAIL = process.env.AUTH_DEFAULT_USER_EMAIL ?? 'jsmith@example.com';
const PASSWORD = process.env.AUTH_DEFAULT_USER_PASSWORD ?? ']60.a6{CJ}lB*rHAp;w;';

const LOGGED_OUT = process.env.VIDEO_LOGGED_OUT === '1';

export default {
  baseURL: BASE_URL,

  // The app defaults to `system` (ThemeProvider defaultTheme="system"), so the
  // context's colorScheme is what actually picks dark mode. CI apps film dark.
  colorScheme: 'dark',
  locale: 'en-US',
  timezoneId: 'UTC',

  // See hazard 2. Real timers, real clock — unless you have pinned the seed.
  fixedTime: process.env.VIDEO_FIXED_TIME ?? false,

  async onContext(context, { viewport }) {
    // An unstyled or logo-less capture reads as a UI regression but is usually a
    // dead asset. Say so loudly.
    context.on('requestfailed', (req) => {
      if (/\/static\/|\/branding\/|arcgisonline|fonts\.(googleapis|gstatic)/.test(req.url())) {
        console.warn(`  ! asset failed (${viewport}): ${req.url()}`);
      }
    });

    if (LOGGED_OUT) {
      console.log(`  · ${viewport}: VIDEO_LOGGED_OUT=1 — capturing the signed-out shots`);

      return;
    }

    // Same handshake as tests/e2e/global-setup.ts. The session cookie it sets is
    // httpOnly; the app's refresh-on-load re-mints the JWT from it on the first
    // navigation, so no token has to be injected into localStorage.
    const api = context.request;
    await api.get(`${BASE_URL}/api/authenticate/csrf`);
    const { cookies } = await context.storageState();
    const csrf = cookies.find((c) => c.name === 'csrfToken')?.value;
    if (!csrf) {
      throw new Error(
        'capture login failed: /api/authenticate/csrf set no csrfToken cookie — is the API up on :3030 and is Vite proxying /api to it?',
      );
    }

    const res = await api.post(`${BASE_URL}/api/authenticate`, {
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      data: { username: EMAIL, password: PASSWORD },
    });
    if (!res.ok()) {
      throw new Error(
        `capture login failed (${res.status()}) for ${EMAIL} — did the seed run? ${await res.text()}`,
      );
    }
  },
};
