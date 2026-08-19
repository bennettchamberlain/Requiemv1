/**
 * ═══════════════════════════════════════════════════════════════════════════
 * "IS THERE A DATABASE HERE?", ANSWERED SYNCHRONOUSLY, FOR ANY DOMAIN'S SPEC.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Several suites need a real Postgres and must SKIP legibly when there is not
 * one, rather than failing every test on a connection error. Answering that
 * needs two things: work out where the database would be from the environment,
 * and find out whether anything is actually listening there.
 *
 * This lived in `domains/pipeline/__tests__/harness/pipelineHarness.ts`, and
 * `domains/audit`'s trigger spec carried a hand-copied duplicate of it with a
 * comment explaining that the copy existed only because
 * `.dependency-cruiser.mjs` forbids reaching into another domain's internals.
 * That was the right reading of the rule and the wrong place to end up: none of
 * this is pipeline-specific, and a copy is exactly how two answers to "can this
 * suite run?" drift apart. It now sits above the domains, where shared test
 * machinery belongs and where the rule explicitly permits importing it.
 *
 * Each suite passes its own override variable names, which is the only thing
 * that ever differed between the copies.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import dotenv from 'dotenv';

// The rest of the toolchain (`yarn test`, `yarn dev`, `yarn dbmate`) runs with
// DOTENV_CONFIG_PATH pointing at the repo-root .env, and `src/bootstrap.ts` is
// what turns that into process.env for the running app. Test files never import
// bootstrap, so the same load happens here, at module scope, BEFORE anything
// reads process.env — otherwise the connection would resolve to nothing on a
// developer machine whose credentials live only in .env.
dotenv.config({ path: path.resolve(process.cwd(), process.env.DOTENV_CONFIG_PATH ?? '.env') });

/** Where a suite will connect. Never carries a hardcoded credential. */
export interface TestDatabaseConnection {
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
 * Per-suite environment overrides.
 *
 * A suite names its own variables so it can be pointed at a scratch database
 * without moving the whole app — or the other suites — off the dev one.
 */
export interface TestDatabaseOptions {
  /** Checked before `DATABASE_URL`, e.g. `PIPELINE_TEST_DATABASE_URL`. */
  urlEnvVar?: string;
  /** Probe timeout override, e.g. `PIPELINE_TEST_PROBE_TIMEOUT_MS`. Defaults to 2000 ms. */
  probeTimeoutEnvVar?: string;
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
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/**
 * The connection, or `null` when the environment does not describe one.
 *
 * Precedence: the suite's own test URL, then the URL the dev-stack supervisor
 * exports, then the discrete `DATABASE_*` variables `config/` already maps.
 */
export function resolveConnection(options: TestDatabaseOptions = {}): TestDatabaseConnection | null {
  const override = options.urlEnvVar == null ? undefined : process.env[options.urlEnvVar];
  const url = override ?? process.env.DATABASE_URL;

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

/**
 * TCP reachability, SYNCHRONOUSLY.
 *
 * A jest suite must choose `describe` vs `describe.skip` while the module is
 * being evaluated, and these files compile to CommonJS (`jest.config.mjs` →
 * `@swc/jest`), so there is no top-level `await` to reach for. A short-lived
 * child process doing one `net.connect` is the only way to get a real answer at
 * that moment. It costs one process spawn per test file and depends on nothing
 * but a node builtin — notably not `pg`, which the child would have to resolve
 * through Yarn PnP.
 *
 * A TCP handshake proves something is listening, not that it is Postgres with
 * the migrations applied. That split is deliberate: "nothing is listening" is
 * an absent database and must SKIP, whereas "something is listening but the
 * schema is wrong" is a broken setup and must FAIL, with a message naming the
 * command that fixes it.
 *
 * Exported because `pipeline/__tests__/harness/scratchDatabase.ts` asks the same
 * synchronous question about a server it reaches with different
 * (administrative) credentials. It re-exports through the pipeline harness, so
 * there is still exactly one implementation.
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

// Keyed by the caller's override names, so two suites in one jest module
// registry cannot read each other's answer. Jest gives each test FILE its own
// registry, so in practice this caches within a file — which is the point: the
// probe spawns a process and a suite may consult it more than once.
const cachedAvailability = new Map<string, DatabaseAvailability>();

/** Whether a Postgres is reachable for this test run. Cached — see above. */
export function databaseAvailability(options: TestDatabaseOptions = {}): DatabaseAvailability {
  const cacheKey = `${options.urlEnvVar ?? ''}|${options.probeTimeoutEnvVar ?? ''}`;
  const cached = cachedAvailability.get(cacheKey);

  if (cached != null) {
    return cached;
  }

  const connection = resolveConnection(options);

  if (connection == null) {
    const answer: DatabaseAvailability = {
      available: false,
      reason:
        'no database configured — set ' +
        (options.urlEnvVar == null ? 'DATABASE_URL' : `${options.urlEnvVar} or DATABASE_URL`) +
        ', or DATABASE_PASSWORD (plus optional DATABASE_HOST / DATABASE_PORT / DATABASE_USERNAME / ' +
        'DATABASE_NAME). `yarn test` already points DOTENV_CONFIG_PATH at the repo-root .env.',
      target: '(unset)',
    };

    cachedAvailability.set(cacheKey, answer);

    return answer;
  }

  const timeoutMs =
    options.probeTimeoutEnvVar == null
      ? DEFAULT_PROBE_TIMEOUT_MS
      : Number(process.env[options.probeTimeoutEnvVar] ?? DEFAULT_PROBE_TIMEOUT_MS);
  const target = `${connection.host}:${connection.port}/${connection.database}`;

  const answer: DatabaseAvailability = isPortOpen(connection.host, connection.port, timeoutMs)
    ? { available: true, reason: `Postgres reachable at ${target}`, target }
    : {
        available: false,
        reason: `nothing accepting connections at ${target} (probe timeout ${timeoutMs} ms)`,
        target,
      };

  cachedAvailability.set(cacheKey, answer);

  return answer;
}
