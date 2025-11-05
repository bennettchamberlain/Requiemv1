import { Images } from '@ci/shadcn/icons';

import { Empty } from '@/pages/MemoryPage/Components';
import { ResultCard } from '@/pages/MemoryPage/GalleryView/ResultCard';
import type { MemoryItem, SearchResult } from '@/pages/MemoryPage/types.ts';

import { useMemoryService } from '../useMemoryService';

export function GalleryView() {
  const { memories, searchResults } = useMemoryService();

  let combinedResults: (SearchResult | MemoryItem)[] = [];
  combinedResults = combinedResults.concat(memories).concat(searchResults);

  return (
    <>
      {combinedResults.length === 0 ? (
        <Empty
          title="No files or results found"
          description="Upload a file or search to see content here"
          icon={Images}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {combinedResults.map((result) => (
            <ResultCard key={result.id || Math.random()} result={result} />
          ))}
        </div>
      )}
    </>
  );
}
