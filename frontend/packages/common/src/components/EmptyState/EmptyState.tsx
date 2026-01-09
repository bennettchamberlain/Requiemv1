import { type ReactNode } from 'react';
import { type LucideIcon } from '@ci/shadcn/icons';

interface Props {
  icon: LucideIcon;
  message?: string | ReactNode;
}

export function EmptyState({ icon: Icon, message }: Props) {
  const renderedMessage = typeof message === 'string' ? <div>{message}</div> : message;

  return (
    <div className="flex flex-col items-center justify-center absolute inset-0 z-10 gap-4">
      <Icon size={48} className="text-[rgb(6,108,128)]" />

      {renderedMessage}
    </div>
  );
}
