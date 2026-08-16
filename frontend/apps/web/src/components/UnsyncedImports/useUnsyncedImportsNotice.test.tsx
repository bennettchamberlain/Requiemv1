import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetUnsyncedImportsNoticeForTests, useUnsyncedImportsNotice } from './useUnsyncedImportsNotice';

/**
 * The whole point is the gap it closes: parse finishes after the user walked
 * away, and nothing said the records were still in staging. Pinned here:
 * the toast fires only when unpushed runs exist, Sync now performs the Sync
 * card's push, and one page load asks exactly once.
 */

const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });

vi.mock('@ci/shadcn', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();

  return { ...original, useToast: () => ({ toast }) };
});

const listUnpushed = vi.fn(async (): Promise<unknown[]> => []);
const startPush = vi.fn(async () => ({ runs: [{ id: 'run-1' }, { id: 'run-2' }] }));

// STABLE, like the real hook — see useImportApi.test.tsx.
const API = { ready: true, listUnpushed, startPush };

vi.mock('@/pages/ImportPage/useImportApi', () => ({
  useImportApi: () => API,
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetUnsyncedImportsNoticeForTests();
});

describe('useUnsyncedImportsNotice', () => {
  it('stays silent when nothing is unpushed', async () => {
    renderHook(() => useUnsyncedImportsNotice());

    await waitFor(() => expect(listUnpushed).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });

  it('raises a persistent notice with a Sync now action when unpushed runs exist', async () => {
    listUnpushed.mockResolvedValueOnce([{ id: 'run-1' }]);

    renderHook(() => useUnsyncedImportsNotice());

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

    const [message, options] = toast.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } },
    ];

    expect(message).toBe('You have unsynced imports.');
    expect(options.duration).toBe(Infinity);
    expect(options.action.label).toBe('Sync now');

    // The action performs the Sync card's push and reports what it started.
    options.action.onClick();
    await waitFor(() => expect(startPush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Syncing 2 imports.'));
  });

  it('asks once per page load, however many times the layout remounts', async () => {
    listUnpushed.mockResolvedValue([{ id: 'run-1' }]);

    renderHook(() => useUnsyncedImportsNotice());
    await waitFor(() => expect(listUnpushed).toHaveBeenCalledTimes(1));

    renderHook(() => useUnsyncedImportsNotice());
    // Still one check, one toast: navigation must not nag.
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(listUnpushed).toHaveBeenCalledTimes(1);
  });

  it('a failed eligibility check never breaks the shell', async () => {
    listUnpushed.mockRejectedValueOnce(new Error('api down'));

    expect(() => renderHook(() => useUnsyncedImportsNotice())).not.toThrow();
    await waitFor(() => expect(listUnpushed).toHaveBeenCalled());
    expect(toast).not.toHaveBeenCalled();
  });
});
