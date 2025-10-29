import { lazy } from 'react';

import { usePageTitle } from '@ci/common';

import { ResponsiveLoader } from '@/components/ResponsiveLoader';

import { MemoryProvider } from './useMemoryService';

const DesktopPage = lazy(() => import('./DesktopMemoryPage'));
const MobilePage = lazy(() => import('./MobileMemoryPage'));

export function MemoryPage() {
  usePageTitle('Memory - Companion Intelligence');

  return (
    <MemoryProvider args={[]}>
      <ResponsiveLoader desktop={DesktopPage} mobile={MobilePage} />
    </MemoryProvider>
  );
}
