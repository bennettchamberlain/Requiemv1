import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { Package } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof Package> & {
  className?: string;
};

export function ItemIcon({ className, ...props }: Props) {
  return <Package className={cn('text-yellow-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
