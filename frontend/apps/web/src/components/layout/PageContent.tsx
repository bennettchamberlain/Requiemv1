import type { ReactNode } from 'react';

import { useDeviceLayout } from '@ci/common';
import { cn } from '@ci/shadcn';

interface Props {
  children?: ReactNode;
  className?: string;
}

export function PageContent({ children, className }: Props) {
  const { isMobile } = useDeviceLayout();

  const spacing = isMobile
    ? 'p-2 gap-2 pt-[max(0.5rem,env(safe-area-inset-top))]'
    : 'p-6 gap-6 pt-[max(1.5rem,env(safe-area-inset-top))]';

  return (
    <div className={cn(spacing, 'flex flex-col', className, 'w-full h-full overflow-auto')}>{children}</div>
  );
}
