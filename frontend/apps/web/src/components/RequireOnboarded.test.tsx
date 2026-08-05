import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { RequireOnboarded } from './RequireOnboarded';

const h = vi.hoisted(() => ({
  user: { user: null as { id: string; onboarded: boolean } | null, loading: false },
}));

vi.mock('@/hooks', () => ({
  useCurrentUser: () => h.user,
}));

vi.mock('@ci/shadcn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ci/shadcn')>();

  return {
    ...actual,
    useToast: () => ({ toast: { info: vi.fn() } }),
  };
});

function renderGate(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/feed"
          element={
            <RequireOnboarded>
              <div>Feed</div>
            </RequireOnboarded>
          }
        />
        <Route path="/onboarding" element={<div>Onboarding</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireOnboarded', () => {
  it('redirects un-onboarded users to onboarding', () => {
    h.user = { user: { id: '1', onboarded: false }, loading: false };

    renderGate('/feed');

    expect(screen.getByText('Onboarding')).toBeInTheDocument();
  });

  it('allows onboarded users through', () => {
    h.user = { user: { id: '1', onboarded: true }, loading: false };

    renderGate('/feed');

    expect(screen.getByText('Feed')).toBeInTheDocument();
  });
});
