import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { BadgeQuestionMark } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof BadgeQuestionMark> & {
  className?: string;
};

export function AnswerIcon({ className, ...props }: Props) {
  return (
    <BadgeQuestionMark className={cn('text-blue-500', className)} size={24} strokeWidth={1.5} {...props} />
  );
}
