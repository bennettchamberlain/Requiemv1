import type { InboxUnit } from '../../services/ImportInboxService';
import { inboxCommand, select } from '../commands/inbox';
import { CliError } from '../context';

import { harness } from './support/harness';

const unit = (overrides: Partial<InboxUnit> = {}): InboxUnit => ({
  path: 'takeout.zip',
  kind: 'file',
  sizeBytes: 1024,
  fileCount: 1,
  recognized: [{ dataSource: 'google_photos', title: 'Google Photos', confidence: 0.9 }],
  activeRunId: null,
  claimed: false,
  ...overrides,
});

const scan = (units: InboxUnit[]) => ({
  available: true as const,
  inboxDir: '/var/lib/ci-import/inbox',
  units,
  skippedSymlinks: 0,
  truncated: false,
});

describe('ci-import inbox', () => {
  it('only LOOKS by default — the inbox consumes what it imports', async () => {
    const ctx = harness({ scanInbox: async () => scan([unit()]) });

    await inboxCommand(ctx);

    expect(ctx.term.text()).toContain('takeout.zip');
    expect(ctx.term.text()).toContain('ci-import inbox --start');
    expect(ctx.term.text()).toContain('consumes what it imports');
  });

  it('reports skipped symlinks rather than following them', async () => {
    const ctx = harness({ scanInbox: async () => ({ ...scan([unit()]), skippedSymlinks: 3 }) });

    await inboxCommand(ctx);

    expect(ctx.term.text()).toContain('3 symlink(s) skipped');
  });

  it('starts one run per ready unit with --start', async () => {
    const requested: unknown[] = [];
    const ctx = harness({
      scanInbox: async () => scan([unit(), unit({ path: 'mail.zip' })]),
      startInboxRuns: async (units: string[], label: string | null) => {
        requested.push({ units, label });

        return { results: units.map((u, index) => ({ unit: u, runId: `run-${index}` })) };
      },
    });

    await inboxCommand(ctx, { start: true });

    expect(requested).toEqual([{ units: ['takeout.zip', 'mail.zip'], label: null }]);
    expect(ctx.term.text()).toContain('2 of 2 unit(s) started');
  });

  it('never offers a unit another run already claimed', async () => {
    const requested: string[][] = [];
    const ctx = harness({
      scanInbox: async () => scan([unit({ claimed: true }), unit({ path: 'free.zip' })]),
      startInboxRuns: async (units: string[]) => {
        requested.push(units);

        return { results: units.map((u) => ({ unit: u, runId: 'run-1' })) };
      },
    });

    await inboxCommand(ctx, { start: true });

    expect(requested).toEqual([['free.zip']]);
  });

  it('refuses when the appliance cannot read the inbox, naming the directory', async () => {
    const ctx = harness({
      scanInbox: async () => ({
        available: false as const,
        reason: 'The inbox directory is not readable: ENOENT',
        inboxDir: '/var/lib/ci-import/inbox',
        units: [],
        skippedSymlinks: 0,
        truncated: false,
      }),
    });

    await expect(inboxCommand(ctx)).rejects.toThrow(/CI_IMPORT_INBOX_DIR/);
  });

  it('refuses --start when everything matching is already importing', async () => {
    const ctx = harness({ scanInbox: async () => scan([unit({ claimed: true })]) });

    await expect(inboxCommand(ctx, { start: true })).rejects.toThrow(/already being imported/);
  });
});

describe('inbox selection', () => {
  const units = [
    unit({ path: 'photos', recognized: [{ dataSource: 'google_photos', title: 'p', confidence: 0.9 }] }),
    unit({ path: 'mail', recognized: [{ dataSource: 'gmail', title: 'm', confidence: 0.8 }] }),
    unit({ path: 'mystery', recognized: [] }),
  ];

  it('keeps only what --only names', () => {
    expect(select(units, { only: 'gmail' }).map((u) => u.path)).toEqual(['mail']);
  });

  it('drops what --skip names, keeping the unrecognized', () => {
    expect(select(units, { skip: 'gmail' }).map((u) => u.path)).toEqual(['photos', 'mystery']);
  });

  it('takes exact paths from --units and complains about ones the scan did not yield', () => {
    expect(select(units, { units: 'mail,photos' }).map((u) => u.path)).toEqual(['photos', 'mail']);
    expect(() => select(units, { units: 'gone' })).toThrow(CliError);
  });
});
