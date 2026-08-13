import { spawnSync } from 'node:child_process';
import path from 'node:path';

import dotenv from 'dotenv';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE A DB-BACKED SPEC CONNECTS, AND WHETHER IT CAN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lifted out of `pipeline/__tests__/harness/pipelineHarness.ts` when a second
 * domain needed it (`AccountPurgeService.integration.spec.ts`). It sits under
 * `src/domains/__tests__/` because that is where shared test machinery belongs:
 * a spec in one domain reaching into another domain's `__tests__` directory is
 * a `no-cross-domain-internals` violation, and rightly so — the harness is not
 * the pipeline's to own once two domains depend on it.
 *
 * `pipelineHarness.ts` re-exports everything here, so the pipeline suites read
 * exactly as they did before.
 */

dotenv.config({ path: path.resolve(process.cwd(), process.env.DOTENV_CONFIG_PATH ?? '.env') });

// ---------------------------------------------------------------------------
// Connection resolution
// ---------------------------------------------------------------------------

/** Where the harness will connect. Never carries a hardcoded credential. */
export interface HarnessConnection {
  /** Present when a full URL was supplied; the discrete fields are parsed from it. */
  url?: string;
  host: string;
  port: number;
  username: string;
  database: string;
  /** Read from the environment. Never defaulted — an absent password means "no database". */
  password: string;
}

/**
 * Defaults that are NOT secrets.
 *
 * `config/default.json` says host `database` because the app runs inside the
 * compose network; jest runs on the host, where the published port is what is
 * reachable — which is why `.env` sets `DATABASE_HOST=localhost`. Defaulting to
 * localhost means a developer with a running stack needs no extra setup, while
 * the password is only ever read, never assumed.
 */
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5432;
const DEFAULT_USERNAME = 'companion';
const DEFAULT_DATABASE = 'companion';

/**
 * The connection, or `null` when the environment does not describe one.
 *
 * Precedence: an explicit test URL, then the URL the dev-stack supervisor
 * exports, then the discrete `DATABASE_*` variables `config/` already maps.
 * `PIPELINE_TEST_DATABASE_URL` exists so this suite can be pointed at a scratch
 * database without moving the whole app off the dev one.
 */
export function resolveConnection(): HarnessConnection | null {
  const url = process.env.PIPELINE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (url != null && url.trim().length > 0) {
    try {
      const parsed = new URL(url);

      return {
        url,
        host: parsed.hostname,
        port: parsed.port.length > 0 ? Number(parsed.port) : DEFAULT_PORT,
        username: decodeURIComponent(parsed.username) || DEFAULT_USERNAME,
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, '') || DEFAULT_DATABASE,
      };
    } catch {
      // A malformed URL is a configuration mistake, not an absent database, but
      // it is reported as unavailable (with the reason) rather than thrown so
      // the suite skips legibly instead of failing every test on a parse error.
      return null;
    }
  }

  const password = process.env.DATABASE_PASSWORD;

  // The one field with no default. Everything else about this database is
  // public knowledge living in config/default.json; the password lives in .env,
  // and its absence is precisely the signal "there is no database here".
  if (password == null || password.length === 0) {
    return null;
  }

  return {
    host: process.env.DATABASE_HOST ?? DEFAULT_HOST,
    port: Number(process.env.DATABASE_PORT ?? DEFAULT_PORT),
    username: process.env.DATABASE_USERNAME ?? DEFAULT_USERNAME,
    database: process.env.DATABASE_NAME ?? DEFAULT_DATABASE,
    password,
  };
}

/** Answer to "can this suite run?", computed without any I/O the caller must await. */
export interface DatabaseAvailability {
  available: boolean;
  /** Human-readable explanation, printed by the spec when it skips. */
  reason: string;
  /** `host:port/database`, never including the password. */
  target: string;
}

/** How long the connectivity probe waits. Overridable for slow or loaded machines. */
const PROBE_TIMEOUT_MS = Number(process.env.PIPELINE_TEST_PROBE_TIMEOUT_MS ?? 2_000);

/**
 * TCP reachability, SYNCHRONOUSLY.
 *
 * A jest suite must choose `describe` vs `describe.skip` while the module is
 * being evaluated, and this file compiles to CommonJS (`jest.config.mjs` →
 * `@swc/jest`), so there is no top-level `await` to reach for. A short-lived
 * child process doing one `net.connect` is the only way to get a real answer at
 * that moment. It costs one process spawn per test file and depends on nothing
 * but a node builtin — notably not `pg`, which the child would have to resolve
 * through Yarn PnP.
 *
 * A TCP handshake proves something is listening, not that it is Postgres with
 * the migrations applied. That split is deliberate: "nothing is listening" is
 * an absent database and must SKIP, whereas "something is listening but the
 * schema is wrong" is a broken setup and must FAIL, with the message from
 * {@link PipelineHarness.start} naming the command that fixes it.
 *
 * Exported for `scratchDatabase.ts`, which needs the same synchronous answer
 * about a server it reaches with different (administrative) credentials.
 */
export function isPortOpen(host: string, port: number, timeoutMs: number): boolean {
  const script =
    "const net = require('node:net');" +
    'const socket = net.connect({ host: process.argv[1], port: Number(process.argv[2]) });' +
    'socket.setTimeout(Number(process.argv[3]));' +
    "socket.on('connect', () => { socket.destroy(); process.exit(0); });" +
    "socket.on('timeout', () => { socket.destroy(); process.exit(1); });" +
    "socket.on('error', () => { process.exit(1); });";

  const probe = spawnSync(process.execPath, ['-e', script, host, String(port), String(timeoutMs)], {
    // Generous relative to the socket's own timeout: this bounds process
    // startup, not the connection, so a merely slow spawn is never misread as
    // an unreachable database.
    timeout: timeoutMs + 5_000,
    stdio: 'ignore',
  });

  return probe.status === 0;
}

let cachedAvailability: DatabaseAvailability | null = null;

/**
 * Whether a Postgres is reachable for this test run. Cached — the probe spawns
 * a process, and a suite may consult it more than once.
 */
export function databaseAvailability(): DatabaseAvailability {
  if (cachedAvailability != null) {
    return cachedAvailability;
  }

  const connection = resolveConnection();

  if (connection == null) {
    cachedAvailability = {
      available: false,
      reason:
        'no database configured — set PIPELINE_TEST_DATABASE_URL or DATABASE_URL, or DATABASE_PASSWORD ' +
        '(plus optional DATABASE_HOST / DATABASE_PORT / DATABASE_USERNAME / DATABASE_NAME). ' +
        '`yarn test` already points DOTENV_CONFIG_PATH at the repo-root .env.',
      target: '(unset)',
    };

    return cachedAvailability;
  }

  const target = `${connection.host}:${connection.port}/${connection.database}`;

  if (!isPortOpen(connection.host, connection.port, PROBE_TIMEOUT_MS)) {
    cachedAvailability = {
      available: false,
      reason: `nothing accepting connections at ${target} (probe timeout ${PROBE_TIMEOUT_MS} ms)`,
      target,
    };

    return cachedAvailability;
  }

  cachedAvailability = { available: true, reason: `Postgres reachable at ${target}`, target };

  return cachedAvailability;
}
