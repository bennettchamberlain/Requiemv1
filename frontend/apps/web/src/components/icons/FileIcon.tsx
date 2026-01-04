import { type ComponentProps } from 'react';

import { cn } from '@ci/shadcn';
import { File } from '@ci/shadcn/icons';

type Props = ComponentProps<typeof File> & {
  className?: string;
};

export function FileIcon({ className, ...props }: Props) {
  return <File className={cn('text-gray-500', className)} size={24} strokeWidth={1.5} {...props} />;
}
