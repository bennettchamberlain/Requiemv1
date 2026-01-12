import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { NotebookPen } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof NotebookPen> & {
  className?: string;
};

export function NoteIcon({ className, ...props }: Props) {
  return <NotebookPen className={cn('text-teal-600', className)} size={24} strokeWidth={1.5} {...props} />;
}
