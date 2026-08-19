import { useEffect, useRef } from 'react';

import { LoadingPage } from '@ci/common';
import { useToast } from '@ci/shadcn';
import { Navigate, useLocation } from 'react-router-dom';

import { useCurrentUser } from '@/hooks';

const ONBOARDED_ALLOWLIST = ['/onboarding', '/oauth/callback', '/openid/callback'];

export function RequireOnboarded({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, loading } = useCurrentUser();
  const { toast } = useToast();
  const notifiedRef = useRef(false);

  const isAllowlisted = ONBOARDED_ALLOWLIST.some((path) => location.pathname.startsWith(path));

  useEffect(() => {
    if (loading || !user || user.onboarded || isAllowlisted || notifiedRef.current) {
      return;
    }

    notifiedRef.current = true;
    toast.info(
      'Finish setting up your companion to unlock Companion Memory. Your progress is saved — pick up where you left off.',
    );
  }, [loading, user, isAllowlisted, toast]);

  if (loading) {
    return <LoadingPage />;
  }

  if (user && !user.onboarded && !isAllowlisted) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}
