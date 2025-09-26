import { lazy } from 'react';

import { ResponsiveLoader } from '@/components/ResponsiveLoader';

const DesktopPage = lazy(() =>
  import('./DesktopMemoryPage').then((module) => ({ default: module.DesktopMemoryPage })),
);
const MobilePage = lazy(() =>
  import('./MobileMemoryPage').then((module) => ({ default: module.MobileMemoryPage })),
);

export default function MemoryPage() {
  return <ResponsiveLoader desktop={DesktopPage} mobile={MobilePage} />;
}
