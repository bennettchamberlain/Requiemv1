import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { TvMinimal } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof TvMinimal> & {
  className?: string;
};

export function ContentIcon({ className, ...props }: Props) {
  return <TvMinimal className={cn('text-pink-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
