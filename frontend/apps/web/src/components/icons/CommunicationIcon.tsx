import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { MessageSquare } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof MessageSquare> & {
  className?: string;
};

export function CommunicationIcon({ className, ...props }: Props) {
  return <MessageSquare className={cn('text-green-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
