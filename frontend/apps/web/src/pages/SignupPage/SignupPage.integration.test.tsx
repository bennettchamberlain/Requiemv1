import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedirectKnownUser } from '@/components/RedirectKnownUser';
import { AuthProvider } from '@/hooks/useAuth';

import { SignupPage } from './SignupPage';

// Exercises the real wiring — SignupPage -> useAuth.signup -> fetchJson -> the
// form's issue mapping — against real Response objects. The unit tests mock
// useAuth and hand the form an error that is already present at submit time,
// which hides ordering bugs in the genuine async submit flow.
vi.mock('@/common/feature', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => false }),
}));

// Only useCurrentUser is stubbed (it needs Apollo); useAuth and the route gate
// stay real, because their interaction is what this file guards.
vi.mock('@/hooks', async (importActual) => ({
  ...(await importActual<typeof import('@/hooks')>()),
  useCurrentUser: () => ({ user: null, loading: false, error: null, refetch: vi.fn() }),
}));

const VALIDATION_400 = {
  message: 'Validation failed',
  errors: [
    {
      code: 'too_small',
      minimum: 6,
      type: 'string',
      inclusive: true,
      exact: false,
      message: 'Password must be at least 6 characters',
      path: ['password'],
    },
  ],
};

function stubApi(signupBody: unknown, signupStatus = 400) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/api/signup')) {
        // Deliberately not instant: a request that settles within the same
        // batch never lets React commit the in-flight render, which is
        // precisely the render that used to unmount this form.
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify(signupBody), {
                  status: signupStatus,
                  headers: { 'content-type': 'application/json' },
                }),
              ),
            20,
          ),
        );
      }

      // No session on a signup page. The live API answers 400 "No token
      // provided" here, which leaves useAuth's shared error slot non-null
      // before the user ever submits — reproduce that exactly.
      if (url.endsWith('/api/authenticate/refresh')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ message: 'No token provided', error: 'Bad Request', statusCode: 400 }),
            {
              status: 400,
              headers: { 'content-type': 'application/json' },
            },
          ),
        );
      }

      return Promise.resolve(new Response('', { status: 204 }));
    }),
  );
}

// Mirrors App.tsx: the signup route is wrapped in RedirectKnownUser. Rendering
// SignupPage bare hides the bug this file exists for — the gate used to swap in
// LoadingPage while the signup POST was in flight, unmounting the form.
function renderSignup() {
  return render(
    <MemoryRouter>
      <AuthProvider args={[]}>
        <RedirectKnownUser>
          <SignupPage />
        </RedirectKnownUser>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function submitShortPassword() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test User' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrfToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('signup page end to end', () => {
  it('renders the form on a fresh load with no session', async () => {
    stubApi(VALIDATION_400);

    renderSignup();

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the server password rule under the password field', async () => {
    stubApi(VALIDATION_400);

    renderSignup();
    await screen.findByLabelText('Password');
    submitShortPassword();

    expect(await screen.findByText('Password must be at least 6 characters')).toBeInTheDocument();
    // The issue mapped onto a field, so the generic alert must not appear.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('keeps what the user typed after a rejected submission', async () => {
    stubApi(VALIDATION_400);

    renderSignup();
    await screen.findByLabelText('Password');
    submitShortPassword();

    // The form must survive the request: a route gate that swaps in a loading
    // page mid-flight remounts it, silently clearing every field.
    await screen.findByText('Password must be at least 6 characters');
    expect(screen.getByLabelText('Name')).toHaveValue('Test User');
    expect(screen.getByLabelText('Email')).toHaveValue('user@example.com');
  });

  it('shows a non-field error in the alert', async () => {
    stubApi({ statusCode: 400, message: 'Email already in use', error: 'Bad Request' });

    renderSignup();
    await screen.findByLabelText('Password');
    submitShortPassword();

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already in use');
  });
});
