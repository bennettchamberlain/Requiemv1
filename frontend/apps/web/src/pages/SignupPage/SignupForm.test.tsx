import { FetchJsonError } from '@ci/common';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SignupForm } from './SignupForm';

// The form owns no password rules — the backend signup schema is the single
// source of truth, and its zod issues are mapped back onto the fields, but
// only for submissions made by this mounted form (useAuth's error is
// app-wide state that survives navigation).
const h = vi.hoisted(() => ({
  error: null as unknown,
  codesRequired: false,
}));

vi.mock('../../hooks', () => ({
  useAuth: () => [{ loading: false, error: h.error }, {}],
}));

vi.mock('@/common/feature', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => h.codesRequired }),
}));

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test User' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
}

describe('SignupForm server validation feedback', () => {
  it('renders the pristine form when there is no error at all', () => {
    // The default state: useAuth reports no error. Reading error.message
    // unguarded here crashed the whole app on every page load.
    h.error = null;

    render(<SignupForm />);

    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a fallback message for a non-Error rejection', () => {
    // useAuth stores whatever was thrown; a string or object must not blank
    // the page or render "undefined" in the alert.
    h.error = 'boom';

    render(<SignupForm />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
  });

  it('maps field-level issues onto the inputs after a submission', async () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Validation failed', [
      { path: ['password'], message: 'Password must be at least 6 characters' },
    ]);

    render(<SignupForm />);
    fillAndSubmit();

    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
    // Every issue landed on a field, so the generic alert stays hidden.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not paint stale field errors onto a form that has not submitted', () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Validation failed', [
      { path: ['password'], message: 'Password must be at least 6 characters' },
    ]);

    render(<SignupForm />);

    // A stale app-wide error surfaces only as the alert, exactly as before.
    expect(screen.getByRole('alert')).toHaveTextContent('Validation failed');
    expect(screen.queryByText('Password must be at least 6 characters')).not.toBeInTheDocument();
  });

  it('resurfaces the alert when editing clears a mapped field error', async () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Validation failed', [
      { path: ['password'], message: 'Password must be at least 6 characters' },
    ]);

    render(<SignupForm />);
    fillAndSubmit();
    await screen.findByText('Password must be at least 6 characters');

    // First keystroke after the failed submit revalidates and clears the
    // server-mapped error; the failure must not become invisible.
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 6 characters'),
    );
  });

  it('keeps unmapped issues visible in the alert alongside mapped ones', async () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Validation failed', [
      { path: ['password'], message: 'Password must be at least 6 characters' },
      { path: ['terms_accepted'], message: 'You must accept the terms' },
    ]);

    render(<SignupForm />);
    fillAndSubmit();

    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('You must accept the terms');
  });

  it('routes signup_code issues to the alert when its input is not rendered', async () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Validation failed', [
      { path: ['signup_code'], message: 'Signup code is required' },
    ]);

    render(<SignupForm />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Signup code is required'));
  });

  it('falls back to the alert for errors without field issues', () => {
    h.error = new FetchJsonError(400, 'Bad Request', 'Email already in use');

    render(<SignupForm />);

    expect(screen.getByRole('alert')).toHaveTextContent('Email already in use');
  });
});
