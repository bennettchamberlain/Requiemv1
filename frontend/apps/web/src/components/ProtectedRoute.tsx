import { LoadingPage } from '@ci/common';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../hooks';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [{ expired, user, loading }] = useAuth();

  if (expired) {
    return <Navigate to="/login" />;
  }

  if (loading) {
    return <LoadingPage />;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}
