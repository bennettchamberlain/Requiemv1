import { Card, Badge } from '@ci/shadcn';
import { BadgeQuestionMark, Clock, Globe } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import type { MemoryItem } from '@/pages/MemoryPage/types.ts';

export interface Props {
  result: MemoryItem;
}

function getActivityTypeIcon(type: string) {
  switch (type) {
    case 'visit':
      return <Globe className="h-4 w-4" />;
    default:
      return <BadgeQuestionMark className="h-4 w-4" />;
  }
}

const formatDuration = (seconds: number) => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  } else {
    return `${Math.round(seconds / 3600)}h`;
  }
};

export function BrowserActivityCard({ result }: Props) {
  const actionType = result.metadata?.actionType as string | undefined;
  const durationSeconds = result.metadata?.durationSeconds as number | undefined;
  const url = result.metadata?.url as string | undefined;

  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <Card.Header className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            variant="secondary"
            className={`bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 flex items-center gap-1`}
          >
            <Globe className="h-4 w-4" />
            <span className="capitalize">{result.type}</span>
          </Badge>
          <Badge
            variant="secondary"
            className={`bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 flex items-center gap-1`}
          >
            {getActivityTypeIcon(actionType || '')}
            <span className="capitalize">{actionType}</span>
          </Badge>
          {durationSeconds && (
            <Badge
              variant="secondary"
              className={`bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 flex items-center gap-1`}
            >
              <Clock className="h-4 w-4" />
              <span>{formatDuration(durationSeconds)}</span>
            </Badge>
          )}
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {result.id.substring(0, 8)}...
          </code>
        </div>
      </Card.Header>

      <Card.Content>
        <Link
          to={`${url}`}
          target="_blank"
          className=" text-blue-900 hover:text-blue-400 hover:cursor-pointer"
        >
          {url}
        </Link>
      </Card.Content>
    </Card>
  );
}
