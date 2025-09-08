import { type ElementType, type ReactNode, Suspense } from 'react';

import { LoadingPage, useDeviceLayout } from '@ci/common';

interface Props {
  desktop: ElementType;
  mobile: ElementType;
  fallback?: ReactNode;
}

export function ResponsiveLoader({
  desktop: DesktopComponent,
  mobile: MobileComponent,
  fallback = <LoadingPage />,
}: Props) {
  const { isMobile } = useDeviceLayout();

  return <Suspense fallback={fallback}>{isMobile ? <MobileComponent /> : <DesktopComponent />}</Suspense>;
}
