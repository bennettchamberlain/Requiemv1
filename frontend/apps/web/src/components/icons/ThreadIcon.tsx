import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { BotMessageSquare } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof BotMessageSquare> & {
  className?: string;
};

export function ThreadIcon({ className, ...props }: Props) {
  return (
    <BotMessageSquare className={cn('text-teal-500', className)} size={24} strokeWidth={1.5} {...props} />
  );
}
