import { useState } from 'react';
import { Button, Card, Input, Table } from '@ci/shadcn';
import { AlertCircle, Search, Loader2 } from '@ci/shadcn/icons';

interface SearchResult {
  id: number;
  source_id: string;
  source_label: string;
  distance: number;
  raw_input?: string;
}

export function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

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

      // Get the token from localStorage
      const token = localStorage.getItem('feathers-jwt');

      if (!token) {
        console.error('SearchPage: No authentication token found');
        throw new Error('Authentication token not found');
      }

      console.log('SearchPage: Making API request to search service');
      const response = await fetch(
        `http://dev.companionintelligence.com/api/search?query=${encodeURIComponent(searchQuery)}&limit=20`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

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

  const truncateText = (text: string | undefined, maxLength: number = 100) => {
    if (!text) return 'N/A';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const formatDistance = (distance: number) => {
    return distance.toFixed(4);
  };

  const getSourceTypeColor = (sourceLabel: string) => {
    if (sourceLabel.startsWith('content.')) return 'text-blue-600';
    if (sourceLabel.startsWith('questions.')) return 'text-green-600';
    return 'text-gray-600';
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card className="w-full">
        <Card.Header>
          <Card.Title className="text-2xl">Semantic Search</Card.Title>
          <Card.Description>Search through your knowledge base using natural language</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-6">
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
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  {searchResults.length > 0 ? `Found ${searchResults.length} results` : 'No results found'}
                </h3>
                {searchResults.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    Sorted by relevance (lower distance = more relevant)
                  </span>
                )}
              </div>

              {searchResults.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <Table.Header>
                      <Table.Row>
                        <Table.Head className="w-[100px]">Distance</Table.Head>
                        <Table.Head className="w-[150px]">Source</Table.Head>
                        <Table.Head>Content</Table.Head>
                        <Table.Head className="w-[150px]">Source ID</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {searchResults.map((result) => (
                        <Table.Row key={result.id}>
                          <Table.Cell className="font-mono text-sm">
                            {formatDistance(result.distance)}
                          </Table.Cell>
                          <Table.Cell>
                            <span
                              className={`text-sm font-medium ${getSourceTypeColor(result.source_label)}`}
                            >
                              {result.source_label}
                            </span>
                          </Table.Cell>
                          <Table.Cell className="max-w-md">
                            <p className="text-sm line-clamp-2">{truncateText(result.raw_input, 200)}</p>
                          </Table.Cell>
                          <Table.Cell className="font-mono text-xs">
                            {result.source_id.substring(0, 8)}...
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              ) : (
                hasSearched && (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No results found for your search query.</p>
                    <p className="text-sm mt-2">
                      Try using different keywords or a more general search term.
                    </p>
                  </div>
                )
              )}
            </div>
          )}

          {/* Initial State */}
          {!hasSearched && !error && (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Enter a search query to find relevant content</p>
              <p className="text-sm mt-2">The search uses semantic similarity to find related information</p>
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
