import { useEffect, useState, useCallback } from 'react';

import { Card, Badge } from '@ci/shadcn';
import { Hash } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';
import { formatPath, truncateText } from '@/pages/MemoryPage/ListView/utils.tsx';
import type { SearchResult } from '@/pages/MemoryPage/types.ts';

export interface Props {
  result: SearchResult;
}

export function AnswerCard({ result }: Props) {
  const [{ authToken }] = useAuth();
  const [relatedQuestion, setRelatedQuestion] = useState<{ [key: string]: unknown } | null>(null);

  const hydrateQuestion = useCallback(async () => {
    const question = await (
      await fetch(`/api/questions/${result.related_id}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })
    ).json();
    setRelatedQuestion(question);
  }, [result]);

  useEffect(() => {
    if (result.related_table === 'questions' && result.related_id != null) {
      hydrateQuestion();
    }
  }, [result]);

  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <Card.Header className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            variant="secondary"
            className={`bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 flex items-center gap-1`}
          >
            <Hash className="h-4 w-4" />
            <span className="capitalize">{result.type}</span>
          </Badge>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {result.id.substring(0, 8)}...
          </code>
        </div>

        {result.path && (
          <div className="text-xs text-muted-foreground font-mono">{formatPath(result.path)}</div>
        )}
      </Card.Header>

      <Card.Content>
        <p className="text-sm text-muted-foreground line-clamp-4">{truncateText(result.text, 200)}</p>

        {result.metadata && Object.keys(result.metadata).length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.metadata)
                .slice(0, 3)
                .map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <span className="text-muted-foreground">{key}:</span>{' '}
                    <span className="font-medium">{String(value)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Card.Content>

      {relatedQuestion != null && (
        <Card.Content>
          <p className="text-md line-clamp-4">Related Question</p>
          <p className="text-sm text-muted-foreground line-clamp-4">
            {truncateText(relatedQuestion.text as string, 200)}
          </p>
        </Card.Content>
      )}
    </Card>
  );
}
