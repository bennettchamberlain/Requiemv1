import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { User } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof User> & {
  className?: string;
};

export function PersonIcon({ className, ...props }: Props) {
  return <User className={cn('text-indigo-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
