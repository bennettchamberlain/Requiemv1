import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FetchJsonError } from '@ci/common';

import { SignupForm } from './SignupForm';

// The form owns no password rules — the backend signup schema is the single
// source of truth, and its zod issues are mapped back onto the fields.
const h = vi.hoisted(() => ({
  error: null as unknown,
}));

vi.mock('../../hooks', () => ({
  useAuth: () => [{ loading: false, error: h.error }, {}],
}));

vi.mock('@/common/feature', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => false }),
}));

describe('SignupForm server validation feedback', () => {
  it('attaches field-level issues from the API to the matching input', async () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Validation failed', [
      { path: ['password'], message: 'Password must be at least 6 characters' },
    ]);

    render(<SignupForm />);

    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
    // Every issue mapped to a field, so the generic alert stays hidden.
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument();
  });

  it('falls back to the alert for errors without field issues', () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Email already in use');

    render(<SignupForm />);

    expect(screen.getByText('Email already in use')).toBeInTheDocument();
  });
});
