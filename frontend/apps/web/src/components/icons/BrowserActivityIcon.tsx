import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { Globe } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof Globe> & {
  className?: string;
};

export function BrowserActivityIcon({ className, ...props }: Props) {
  return <Globe className={cn('text-emerald-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
