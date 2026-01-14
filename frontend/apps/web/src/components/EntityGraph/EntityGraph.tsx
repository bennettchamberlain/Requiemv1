import { type ReactNode } from 'react';

import { Card, Spinner } from '@ci/shadcn';

import { useNodeGraphService } from '@/api/useNodeGraphService';
import { ForceGraph } from '@/components/ForceGraph';

interface Props {
  entityId: string;
  emptyState: ReactNode;
}

export function EntityGraph({ entityId, emptyState }: Props) {
  const { data, loading } = useNodeGraphService({
    entityId,
    skip: !entityId,
  });

  let content: ReactNode | null = null;

  if (loading) {
    content = (
      <div className="flex items-center justify-center h-[420px]">
        <Spinner size={48} variant="circle" color="rgb(6,108,128)" />
      </div>
    );
  } else if (data == null) {
    content = emptyState;
  } else {
    content = (
      <ForceGraph
        nodes={data?.nodes ?? []}
        links={data?.links ?? []}
        highlightedNodeId={entityId}
        centerNodeId={entityId}
        selectedNodeId={entityId}
      />
    );
  }

  return (
    <Card className="p-0 flex-1">
      <Card.Content className="p-0">{content}</Card.Content>
    </Card>
  );
}
