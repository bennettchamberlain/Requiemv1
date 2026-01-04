import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { MapPin } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof MapPin> & {
  className?: string;
};

export function PlaceIcon({ className, ...props }: Props) {
  return <MapPin className={cn('text-red-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
