import { useCallback, useMemo } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, usePageTitle } from '@ci/common';
import { useNavigate, useParams } from 'react-router-dom';

import { InfiniteListFooter } from '@/components/InfiniteList';
import { PageContent } from '@/components/layout';
import { MemoryHubShell } from '@/components/MemoryHub';
import { FileModal } from '@/components/modals/FileModal';
import { gql } from '@/graphql';
import { useInfiniteConnection } from '@/hooks/useInfiniteConnection';

import { GridItem } from './GridItem';

/** Content is a thumbnail grid, so a page is a few rows rather than a few items. */
export const PAGE_SIZE = 50;

const GET_FILES = gql(`
  query GetFiles($first: Int, $after: String) {
    files(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          ...FileGridItemFragment
        }
      }
    }
  }
`);

export function FilesPage() {
  usePageTitle('Content - Companion Intelligence');

  const navigate = useNavigate();
  // The open file lives in the URL rather than in local state, so a file has a
  // shareable address and Back closes the viewer. `/memory/content/:fileId`
  // carries the RAW uuid, matching /people/:id and /places/:id; the GraphQL
  // `id` is the base64 global id, so each direction converts explicitly.
  const { fileId } = useParams<{ fileId: string }>();

  const { data, loading, fetchMore } = useQuery(GET_FILES, {
    variables: { first: PAGE_SIZE },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });

  const files = useMemo(() => (data?.files.edges ?? []).map((edge) => edge.node), [data]);

  const fetchNextPage = useCallback(
    (after: string) =>
      fetchMore({
        variables: { after },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult?.files) {
            return prev;
          }

          const prevEdges = prev.files?.edges ?? [];
          const seen = new Set(prevEdges.map((edge) => edge.cursor));
          const nextEdges = fetchMoreResult.files.edges.filter((edge) => !seen.has(edge.cursor));

          return {
            files: {
              ...fetchMoreResult.files,
              edges: [...prevEdges, ...nextEdges],
            },
          };
        },
      }),
    [fetchMore],
  );

  const pagination = useInfiniteConnection({
    connection: data?.files,
    loadedCount: files.length,
    fetchNextPage,
  });

  const selectedFileGlobalId = useMemo(() => {
    if (!fileId) {
      return null;
    }

    // A hand-typed or stale id still encodes fine; the modal then renders its
    // own "no source available" state rather than throwing here.
    return GlobalUID.encode('file', fileId);
  }, [fileId]);

  const handleSelect = useCallback(
    (globalId: string) => navigate(`/memory/content/${GlobalUID.parse('file', globalId)}`),
    [navigate],
  );
  const handleClose = useCallback(() => navigate('/memory/content'), [navigate]);

  return (
    <PageContent ref={pagination.scrollRef} className="gap-4 p-0">
      <MemoryHubShell>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {loading && files.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading content…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {files.map((file) => (
                  <GridItem key={file.id} file={file} onSelect={handleSelect} />
                ))}
              </div>

              <InfiniteListFooter pagination={pagination} noun="content" />
            </>
          )}

          <FileModal fileId={selectedFileGlobalId} onClose={handleClose} />
        </div>
      </MemoryHubShell>
    </PageContent>
  );
}
