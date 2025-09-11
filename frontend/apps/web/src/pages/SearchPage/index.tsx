import { lazy } from 'react';

import { ResponsiveLoader } from '@/components/ResponsiveLoader';

const DesktopPage = lazy(() => import('./DesktopSearchPage'));
const MobilePage = lazy(() => import('./MobileSearchPage'));

export default function SearchPage() {
  return <ResponsiveLoader desktop={DesktopPage} mobile={MobilePage} />;
}
