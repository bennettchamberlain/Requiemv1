import { type ComponentType, type ReactNode, Suspense } from 'react';

import { LoadingPage, useDeviceLayout } from '@ci/common';

// ComponentType rather than ElementType: these are always React components (lazy-loaded pages),
// and ElementType's intrinsic-tag union collapses to `never` props once @react-three/fiber
// augments JSX.IntrinsicElements with the three.js tags.
interface Props {
  desktop: ComponentType;
  mobile: ComponentType;
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
