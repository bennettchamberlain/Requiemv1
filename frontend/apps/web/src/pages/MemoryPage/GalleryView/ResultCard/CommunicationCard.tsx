import { Card, Badge } from '@ci/shadcn';
import { BadgeQuestionMark, Mail, Mails } from '@ci/shadcn/icons';

import DOMPurify from 'dompurify';
import parse from 'html-react-parser';

import type { MemoryItem } from '@/pages/MemoryPage/types.ts';

export interface Props {
  result: MemoryItem;
}

function getCommunicationTypeIcon(type: string) {
  switch (type) {
    case 'email':
      return <Mail className="h-4 w-4" />;
    default:
      return <BadgeQuestionMark className="h-4 w-4" />;
  }
}


export function CommunicationCard({ result }: Props) {
  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <Card.Header className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            variant="secondary"
            className={`bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 flex items-center gap-1`}
          >
            <Mails className="h-4 w-4" />
            <span className="capitalize">{result.type}</span>
          </Badge>
          <Badge
            variant="secondary"
            className={`bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 flex items-center gap-1`}
          >
            {getCommunicationTypeIcon(result?.metadata?.communicationType || '')}
            <span className="capitalize">{result?.metadata?.communicationType}</span>
          </Badge>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {result.id.substring(0, 8)}...
          </code>
        </div>
      </Card.Header>

      <Card.Content>
        {result?.metadata?.communicationType === 'email' && (
          parse(DOMPurify.sanitize(result.description, {USE_PROFILES: {html: true}}))
        )}
      </Card.Content>
    </Card>
  );
}
