import { GraphTabPanel } from '../Components/GraphExplorerModal';

export interface GraphViewProps {
  variant?: 'desktop' | 'mobile';
}

export function GraphView({ variant = 'desktop' }: GraphViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <GraphTabPanel variant={variant} />
    </div>
  );
}
