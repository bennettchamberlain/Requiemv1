import { useMemoryService } from '../useMemoryService';

import { GraphTabPanel } from './GraphExplorerModal';
export interface GraphViewProps {
  variant?: 'desktop' | 'mobile';
}

export function GraphView({ variant = 'desktop' }: GraphViewProps) {
  const { searchQuery } = useMemoryService();

  return (
    <div className="flex flex-col gap-6 p-4 pt-0">
      <GraphTabPanel variant={variant} searchQuery={searchQuery} />
    </div>
  );
}
