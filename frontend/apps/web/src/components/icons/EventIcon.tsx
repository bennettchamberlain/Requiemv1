import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { CalendarFold } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof CalendarFold> & {
  className?: string;
};

export function EventIcon({ className, ...props }: Props) {
  return <CalendarFold className={cn('text-orange-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
