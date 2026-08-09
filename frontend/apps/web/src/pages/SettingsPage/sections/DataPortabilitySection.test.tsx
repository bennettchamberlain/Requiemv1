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

const downloadAccountExport = vi.hoisted(() => vi.fn());
const uploadAccountImport = vi.hoisted(() => vi.fn());
const uploadLegacyAccountImport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/accountDataPortability', () => ({
  downloadAccountExport,
  uploadAccountImport,
  uploadLegacyAccountImport,
}));

describe('DataPortabilitySection', () => {
  beforeEach(() => {
    h.authToken = 'jwt-abc';
    h.email = 'jsmith@example.com';
    downloadAccountExport.mockResolvedValue(undefined);
    uploadAccountImport.mockResolvedValue({
      tablesImported: 1,
      rowsImported: 2,
      filesRestored: 0,
      format: 'ndjson',
    });
  });

  it('starts a streaming export when export is clicked', async () => {
    render(<DataPortabilitySection />);
    fireEvent.click(screen.getByRole('button', { name: 'Export all my data' }));

    await waitFor(() => {
      expect(downloadAccountExport).toHaveBeenCalledWith('jwt-abc');
    });
  });
});
