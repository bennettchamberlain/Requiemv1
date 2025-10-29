import { lazy } from 'react';

import { ResponsiveLoader } from '@/components/ResponsiveLoader';

const MobilePage = lazy(() => import('./MobileSearchPage'));
const DesktopRedirect = lazy(() => import('./DesktopSearchRedirect'));

export default function SearchPage() {
  return <ResponsiveLoader desktop={DesktopRedirect} mobile={MobilePage} />;
}
