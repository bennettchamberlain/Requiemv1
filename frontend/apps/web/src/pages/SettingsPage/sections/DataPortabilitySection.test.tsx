import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataPortabilitySection } from './DataPortabilitySection';

const h = vi.hoisted(() => ({
  authToken: 'jwt-abc' as string | null,
  email: 'jsmith@example.com',
}));

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: h.authToken }],
  useCurrentUser: () => ({ user: { id: 'u1', email: h.email }, loading: false, error: undefined }),
}));

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@ci/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ci/common')>()),
  fetchJson,
}));

describe('DataPortabilitySection', () => {
  beforeEach(() => {
    h.authToken = 'jwt-abc';
    h.email = 'jsmith@example.com';
    fetchJson.mockResolvedValue({
      filename: 'ci-memory-export-2026-08-08.json',
      archive: { version: 1 },
    });
    vi.stubGlobal(
      'URL',
      class {
        static createObjectURL = vi.fn(() => 'blob:export');

        static revokeObjectURL = vi.fn();
      },
    );
  });

  it('requests an export archive when export is clicked', async () => {
    render(<DataPortabilitySection />);
    fireEvent.click(screen.getByRole('button', { name: 'Export all my data' }));

    await waitFor(() => {
      expect(fetchJson).toHaveBeenCalledWith('/api/account/export', expect.any(Object));
    });
  });
});
