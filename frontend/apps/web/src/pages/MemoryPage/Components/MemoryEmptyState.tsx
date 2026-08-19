import { Button } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { Empty } from './Empty';

interface MemoryEmptyStateProps {
  /** True when URL filters or a search query narrowed the browse. */
  filtered: boolean;
}

export function MemoryEmptyState({ filtered }: MemoryEmptyStateProps) {
  if (filtered) {
    return (
      <Empty
        title="No results"
        description="Try clearing your filters or searching for something else."
        icon="🔍"
      />
    );
  }

  return (
    <div className="flex flex-col items-center px-6 py-12">
      <Empty
        title="Your memory is empty"
        description="Connect a source or import data to start building your timeline."
        icon="✨"
      />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link to="/sources/connect">Connect a source</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/settings/data">Import data</Link>
        </Button>
      </div>
    </div>
  );
}
