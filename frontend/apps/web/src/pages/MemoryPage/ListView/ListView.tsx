import { Table } from '@ci/shadcn';
import { Search } from '@ci/shadcn/icons';

import { Empty } from '@/pages/MemoryPage/Components';
import { useMemoryService } from '@/pages/MemoryPage/useMemoryService.tsx';

export function ListView() {
  const { searchQuery, searchResults } = useMemoryService();

  return (
    <div className="pl-2 grid grid-cols-1 gap-1 h-[calc(100vh-150px)] -mx-6 -mb-6">
      {/* Results Display */}
      {searchResults.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                {searchResults.length > 0 ? `Found ${searchResults.length} results` : 'No results found'}
              </h3>
              {searchResults.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Sorted by relevance • Most similar results appear first
                </p>
              )}
            </div>
          </div>

          {searchResults.length > 0 ? (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Type</Table.Head>
                  <Table.Head>Content</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {searchResults.map((result) => (
                  <Table.Row key={result.id}>
                    <Table.Cell className="capitalize">{result.type.replace('_', ' ')}</Table.Cell>
                    <Table.Cell className="font-mono text-xs">{result.text}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          ) : (
            searchQuery?.length > 0 &&
            searchResults?.length === 0 && (
              <Empty
                title="No results found for your search query"
                description="Try using different keywords or a more general search term"
              />
            )
          )}
        </>
      )}

      {/* Initial State */}
      {searchQuery?.length === 0 && (
        <Empty
          title="Enter a search query to find relevant content"
          description="The search uses semantic similarity to find related information"
          icon={Search}
        />
      )}
    </div>
  );
}
