import { useState } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Input, Card, Badge, Table, ToggleGroup } from '@ci/shadcn';
import {
  AlertCircle,
  Search,
  Loader2,
  FileText,
  Image,
  Database,
  Hash,
  Grid3X3,
  List,
} from '@ci/shadcn/icons';

import { PageContent } from '@/components/layout';
import { useAuth } from '@/hooks';

interface SearchResult {
  text: string;
  type: string;
  id: string;
  path: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const getTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'image':
      case 'photo':
        return <Image className="h-4 w-4" />;
      case 'document':
      case 'text':
        return <FileText className="h-4 w-4" />;
      case 'data':
      case 'database':
        return <Database className="h-4 w-4" />;
      default:
        return <Hash className="h-4 w-4" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'image':
      case 'photo':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'document':
      case 'text':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'data':
      case 'database':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const truncateText = (text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength) + '...';
  };

  const formatPath = (path: string) => {
    // Extract meaningful parts from the path
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 3) {
      return `.../${parts.slice(-3).join('/')}`;
    }

    return path;
  };

  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      {result.imageUrl && (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={result.imageUrl}
            alt={`Preview for ${result.type}`}
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
            onError={(e) => {
              // Hide image if it fails to load
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      )}

      <Card.Header className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="secondary" className={`${getTypeColor(result.type)} flex items-center gap-1`}>
            {getTypeIcon(result.type)}
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
    </Card>
  );
}

export function DesktopSearchPage() {
  usePageTitle('Search - Companion Intelligence');
  const [{ authToken }] = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

  const performSearch = async () => {
    if (!searchQuery.trim()) {
      setError('Please enter a search query');

      return;
    }

    try {
      console.log('SearchPage: Starting search with query:', searchQuery);
      setLoading(true);
      setError(null);
      setHasSearched(true);

      console.log('SearchPage: Making API request to search service');
      const response = await fetch(`/api/embeddings/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: searchQuery,
        }),
      });

      if (!response.ok) {
        console.error(
          `SearchPage: API request failed with status ${response.status}: ${response.statusText}`,
        );
        if (response.status === 401) {
          throw new Error('Unauthorized: You do not have permission to access this resource');
        } else if (response.status === 403) {
          throw new Error('Forbidden: Access denied');
        } else if (response.status === 404) {
          throw new Error('API endpoint not found');
        } else if (response.status >= 500) {
          throw new Error('Server error: Please try again later');
        } else {
          throw new Error(`Error performing search: ${response.statusText}`);
        }
      }

      console.log('SearchPage: API request successful, parsing response');

      const data = await response.json();

      // Handle both array response and paginated response
      let resultsData: SearchResult[] = [];

      if (Array.isArray(data)) {
        resultsData = data;
      } else if (data.data && Array.isArray(data.data)) {
        resultsData = data.data;
      } else {
        console.error('SearchPage: Invalid response format', data);

        throw new Error('Invalid response format: Expected an array of search results');
      }

      console.log(`SearchPage: Successfully found ${resultsData.length} results`, resultsData);

      setSearchResults(resultsData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';

      console.error('SearchPage: Error in performSearch():', errorMessage, err);

      setError(errorMessage);
    } finally {
      console.log('SearchPage: Search operation completed');
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Search</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        {/* Search Input */}
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Enter your search query..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-1"
            disabled={loading}
          />
          <Button onClick={performSearch} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-2">Search</span>
          </Button>

          {/* Desktop: Toggle and refresh button */}
          <div className="hidden lg:flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(value) => value && setViewMode(value as 'card' | 'table')}
            >
              <ToggleGroup.Item value="card" aria-label="Card view">
                <Grid3X3 className="h-4 w-4" />
              </ToggleGroup.Item>
              <ToggleGroup.Item value="table" aria-label="Table view">
                <List className="h-4 w-4" />
              </ToggleGroup.Item>
            </ToggleGroup>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium">Error performing search</h3>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Results Display */}
        {hasSearched && !error && (
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
              <>
                <div
                  className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 ${viewMode === 'table' ? 'lg:hidden' : ''}`}
                >
                  {searchResults.map((result) => (
                    <SearchResultCard key={result.id} result={result} />
                  ))}
                </div>
                {viewMode === 'table' && (
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.Head>Type</Table.Head>
                        <Table.Head>ID</Table.Head>
                        <Table.Head>Data Path</Table.Head>
                        <Table.Head>Content</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {searchResults.map((result) => (
                        <Table.Row key={result.id}>
                          <Table.Cell>{result.type}</Table.Cell>
                          <Table.Cell>{result.id}</Table.Cell>
                          <Table.Cell className="max-w-md">{result.path}</Table.Cell>
                          <Table.Cell className="font-mono text-xs">{result.text}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                )}
              </>
            ) : (
              hasSearched && (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No results found for your search query.</p>
                  <p className="text-sm mt-2">Try using different keywords or a more general search term.</p>
                </div>
              )
            )}
          </>
        )}

        {/* Initial State */}
        {!hasSearched && !error && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">Enter a search query to find relevant content</p>
            <p className="text-sm mt-2">The search uses semantic similarity to find related information</p>
          </div>
        )}
      </PageContent>
    </>
  );
}
