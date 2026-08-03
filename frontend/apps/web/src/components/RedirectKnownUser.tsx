import { LoadingPage } from '@ci/common';
import { Navigate } from 'react-router-dom';

import { useAuth, useCurrentUser } from '@/hooks';

export function RedirectKnownUser({ children }: { children: React.ReactNode }) {
  // `initializing`, not `loading`: the latter is also true while a login or
  // signup POST is in flight, and swapping in LoadingPage then unmounts the
  // very form awaiting the response — wiping the user's input and the local
  // state needed to attach the server's field errors.
  const [{ expired, authToken, initializing }] = useAuth();
  const { user, loading: userLoading } = useCurrentUser();

  if (initializing || userLoading) {
    return <LoadingPage />;
  }

  if (expired) {
    return children;
  }

  if (authToken && !user) {
    return <LoadingPage />;
  }

  if (user) {
    if (user.onboarded) {
      return <Navigate to="/feed" />;
    }

    return <Navigate to="/onboarding" />;
  }

  return children;
}
