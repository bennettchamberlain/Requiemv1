import { cn } from '@ci/shadcn';
import { ChevronLeft, ChevronRight } from '@ci/shadcn/icons';

/**
 * Open = vertical rule on the left, arrow pointing out of the edge.
 * Close = arrow pointing back, vertical rule on the right.
 */
export function RailEdgeToggle({
  open,
  onClick,
  className,
}: {
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  const label = open ? 'Close menu' : 'Open menu';

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls="power-rail"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-0.5 rounded-full border border-white/55 bg-white/30 px-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.08)] backdrop-blur-md hover:bg-white/45 dark:border-white/20 dark:bg-white/10 dark:hover:bg-white/20',
        className,
      )}
    >
      {!open && <span aria-hidden className="h-4 w-px bg-foreground/80" />}
      {open ? (
        <ChevronLeft className="h-4 w-4" strokeWidth={2} />
      ) : (
        <ChevronRight className="h-4 w-4" strokeWidth={2} />
      )}
      {open && <span aria-hidden className="h-4 w-px bg-foreground/80" />}
    </button>
  );
}
