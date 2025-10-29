import { lazy } from 'react';

import { ResponsiveLoader } from '@/components/ResponsiveLoader';

const MobilePage = lazy(() => import('./MobileSearchPage'));

export default function SearchPage() {
  return <ResponsiveLoader mobile={MobilePage} />;
}
