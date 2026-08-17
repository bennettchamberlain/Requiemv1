import { cn } from '@ci/shadcn';

import { GraphTabPanel } from './GraphExplorerModal';
export interface GraphViewProps {
  variant?: 'desktop' | 'mobile';
}

export function GraphView({ variant = 'desktop' }: GraphViewProps) {
  // The graph shell is a full-bleed canvas, so the wrapper hands it the whole
  // remaining height instead of stacking it in a scrolling column.
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', variant === 'mobile' ? 'p-2 pt-0' : 'px-2 pb-2 pt-0')}>
      <GraphTabPanel variant={variant} />
    </div>
  );
}
