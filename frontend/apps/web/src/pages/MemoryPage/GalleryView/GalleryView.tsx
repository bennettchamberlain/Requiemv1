import { useCallback, useEffect, useState } from 'react';

import { Images } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';
import { Empty } from '@/pages/MemoryPage/Components';
import { ResultCard } from '@/pages/MemoryPage/GalleryView/ResultCard';
import type { MemoryItem, SearchResult } from '@/pages/MemoryPage/types.ts';

import { useMemoryService } from '../useMemoryService';

export function GalleryView() {
  const [{ authToken }] = useAuth();

  const [files, setFiles] = useState<MemoryItem[]>([]);

  const { memories, searchResults } = useMemoryService();

  const hydrateFiles = useCallback(async () => {
    const tempFiles: MemoryItem[] = [];
    const filtered = memories.filter((memory) => memory.metadata?.entityType === 'File');

    for (const memory of filtered) {
      if (memory.metadata) {
        const tempFile = await (
          await fetch(`/api/files/${memory.metadata.linkedId}`, {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          })
        ).json();
        if (tempFile) {
          memory.file = tempFile;
          tempFiles.push(memory);
        }
      }
    }

    setFiles(tempFiles);
  }, [memories]);

  useEffect(() => {
    hydrateFiles();
  }, [memories]);

  let combinedResults: (SearchResult | MemoryItem)[] = [];

  combinedResults = combinedResults.concat(files).concat(searchResults);

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
