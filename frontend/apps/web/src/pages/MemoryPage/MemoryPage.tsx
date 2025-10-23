import { lazy } from 'react';

import { ResponsiveLoader } from '@/components/ResponsiveLoader';

import { MemoryProvider } from './MemoryProvider';
import { useMemoryQuery } from './utils/queryParser';

const DesktopPage = lazy(() => import('./DesktopMemoryPage'));
const MobilePage = lazy(() => import('./MobileMemoryPage'));

export default function MemoryPage() {
  const query = useMemoryQuery();

  return (
    <MemoryProvider args={[query]}>
      <ResponsiveLoader desktop={DesktopPage} mobile={MobilePage} />
    </MemoryProvider>
  );
}
