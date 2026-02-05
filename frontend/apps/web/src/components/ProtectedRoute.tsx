import { LoadingPage } from '@ci/common';
import { Navigate } from 'react-router-dom';

import { useAuth, useCurrentUser } from '@/hooks';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [{ expired, loading: authLoading }] = useAuth();
  const { user, loading: userLoading } = useCurrentUser();

  if (expired) {
    return <Navigate to="/login" />;
  }

  if (authLoading || userLoading) {
    return <LoadingPage />;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return children;
}
