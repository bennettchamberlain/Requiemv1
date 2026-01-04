import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { Lightbulb } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof Lightbulb> & {
  className?: string;
};

export function ConceptIcon({ className, ...props }: Props) {
  return <Lightbulb className={cn('text-purple-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
