import { GlobalUID, LoadingPage } from '@ci/common';
import { Navigate } from 'react-router-dom';

import { useCurrentUser } from '@/hooks';

/** Knowledge hub section — opens the signed-in user's person graph. */
export function MemoryKnowledgeRedirect() {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return <LoadingPage />;
  }

  if (!user?.entity?.id) {
    return <Navigate to="/memory/people" replace />;
  }

  return <Navigate to={`/people/${GlobalUID.parse('person', user.entity.id)}`} replace />;
}
