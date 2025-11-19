import { cn } from '@ci/shadcn';

interface Props {
  className?: string;
}

export function ChatLoader({ className: outerClassName }: Props) {
  const dotClassName =
    'w-1.5 h-1.5 bg-muted-foreground/30 rounded-full animate-bounce transform-gpu will-change-transform';

  return (
    <div className={cn('flex gap-2 justify-center items-center', outerClassName)}>
      <div className={dotClassName} style={{ animationDelay: '0ms' }} />
      <div className={dotClassName} style={{ animationDelay: '150ms' }} />
      <div className={dotClassName} style={{ animationDelay: '300ms' }} />
    </div>
  );
}
