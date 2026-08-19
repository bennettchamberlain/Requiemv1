import { Button } from '@ci/shadcn';

import type { InfiniteConnection } from '@/hooks/useInfiniteConnection';

/**
 * The tail of an infinitely-scrolled list: the scroll sentinel, a retry for a
 * failed page, and — always — a count of how much of the collection is actually
 * on screen. The count is not decoration; a list that renders 500 of 1,179 rows
 * and says nothing is the bug this component exists to prevent.
 */
export function InfiniteListFooter({
  pagination,
  noun,
  className,
}: {
  pagination: InfiniteConnection;
  /** Plural noun for the retry message, e.g. "places". */
  noun: string;
  className?: string;
}) {
  const { sentinelRef, showSentinel, loadMoreError, retry, statusLabel } = pagination;

  return (
    <div className={className}>
      {showSentinel && <div ref={sentinelRef} className="h-8" />}

      {loadMoreError != null && (
        <div className="flex flex-col items-center gap-2 py-3">
          <div className="text-sm text-muted-foreground">
            Couldn&apos;t load more {noun}: {loadMoreError}
          </div>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      <div className="py-3 text-center text-xs text-muted-foreground">{statusLabel}</div>
    </div>
  );
}
