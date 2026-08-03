/**
 * Redaction cases every copy of the scrubber must handle identically.
 *
 * There are four implementations of these rules in this repo — the API
 * (`common/telemetry/scrubEvent.ts`), the web bundle
 * (`frontend/apps/web/src/lib/telemetry.ts`) and the two Python services — and
 * they live in separate build graphs, so nothing shares code between them. The
 * browser copy originally shipped with NONE of the string rules, which an
 * adversarial review caught and a parity check would have caught first.
 *
 * COPY — keep byte-identical to
 * backend/apps/api/src/common/telemetry/scrubFixtures.ts (a parity test in each
 * suite asserts this). Both TypeScript suites run it through their own
 * `scrubString`. The
 * Python twins are held in lockstep by test_telemetry_twin_parity.py plus their
 * own copies of these cases.
 *
 * Deliberately expressed as string→string so it can be consumed by any copy
 * without importing an SDK type.
 */
export interface ScrubCase {
  readonly name: string;
  readonly input: string;
  /** Substrings that must NOT survive. */
  readonly mustNotContain?: readonly string[];
  /** Exact expected output, where the rule is fully deterministic. */
  readonly expected?: string;
}

export const SCRUB_CASES: readonly ScrubCase[] = [
  {
    name: 'bearer token',
    input: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
    mustNotContain: ['eyJhbGciOiJIUzI1NiJ9'],
  },
  {
    name: 'labelled api key',
    input: 'api_key=sk-live-1234567890',
    mustNotContain: ['sk-live-1234567890'],
  },
  {
    name: 'hyphenated api key',
    input: 'api-key: sk-live-0987654321',
    mustNotContain: ['sk-live-0987654321'],
  },
  {
    name: 'labelled password',
    input: 'password: hunter2',
    mustNotContain: ['hunter2'],
  },
  {
    name: 'tailscale auth key',
    input: 'tskey-auth-abc123-def456',
    expected: '[Filtered]',
  },
  {
    name: 'credentials in a connection URL',
    input: 'postgres://ci:pgadmin_s3cure@db:5432/companion',
    mustNotContain: ['pgadmin_s3cure'],
  },
  {
    name: 'macOS home path',
    input: '/Users/liam/devel/ci/file.ts',
    expected: '~/devel/ci/file.ts',
  },
  {
    name: 'Linux home path',
    input: '/home/ci/data/timeline.db',
    expected: '~/data/timeline.db',
  },
  {
    name: 'Windows home path, backslash',
    input: 'C:\\Users\\liam\\app.log',
    expected: '~\\app.log',
  },
  {
    // Regression: the macOS rule used to match inside this and leave `C:~/…`.
    name: 'Windows home path, forward slash',
    input: 'C:/Users/liam/AppData/ci',
    expected: '~/AppData/ci',
  },
  {
    name: 'ordinary text is untouched',
    input: 'Cannot read properties of undefined (reading "id")',
    expected: 'Cannot read properties of undefined (reading "id")',
  },
];

/** Strings longer than this must be truncated by every copy. */
export const MAX_STRING_LENGTH = 8000;
