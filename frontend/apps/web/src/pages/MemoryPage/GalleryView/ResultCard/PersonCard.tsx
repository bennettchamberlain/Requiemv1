import { Card, Badge } from '@ci/shadcn';
import { User } from '@ci/shadcn/icons';

import { truncateText } from '@/pages/MemoryPage/ListView/utils.tsx';
import type { MemoryItem } from '@/pages/MemoryPage/types.ts';

export interface Props {
  result: MemoryItem;
}

export function PersonCard({ result }: Props) {
  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <Card.Header className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            variant="secondary"
            className={`bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 flex items-center gap-1`}
          >
            <User className="h-4 w-4" />
            <span className="capitalize">{result.type}</span>
          </Badge>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {result.id.substring(0, 8)}...
          </code>
        </div>
      </Card.Header>

      <Card.Content>
        {result?.title && (
          <p className="text-sm text-foreground line-clamp-4">{truncateText(result.title, 200)}</p>
        )}

        {result?.metadata?.properties?.email != null && (
          <div className="mt-4 pt-4">
            <div className="flex flex-wrap gap-2">
              <div className="text-xs">
                <span className="text-muted-foreground">{result.metadata.properties.email}</span>
              </div>
            </div>
          </div>
        )}

        {result?.description != null && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex flex-wrap gap-2">
              <div className="text-xs">
                <span className="text-muted-foreground">{result.description}</span>
              </div>
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
