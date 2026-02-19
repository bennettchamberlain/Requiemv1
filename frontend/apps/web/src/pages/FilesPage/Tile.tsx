import { type ReactNode } from 'react';

export function Tile({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label?: string | null;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <div className="flex flex-col gap-1.5">
      <Wrapper
        {...(onClick ? { onClick, type: 'button' as const } : {})}
        className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted transition-transform hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full"
      >
        {children}
      </Wrapper>
      {label && <span className="text-xs text-muted-foreground truncate px-0.5">{label}</span>}
    </div>
  );
}
