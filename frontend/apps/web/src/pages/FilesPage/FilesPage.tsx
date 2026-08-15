import { useCallback, useState } from 'react';

import { useQuery } from '@apollo/client';
import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { MemoryHubShell } from '@/components/MemoryHub';
import { FileModal } from '@/components/modals/FileModal';
import { gql } from '@/graphql';

import { GridItem } from './GridItem';

const GET_FILES = gql(`
  query GetFiles($first: Int, $after: String) {
    files(first: $first, after: $after) {
      edges {
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

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { data, loading } = useQuery(GET_FILES, {
    variables: { first: 50 },
    fetchPolicy: 'cache-and-network',
  });

  const handleClose = useCallback(() => setSelectedFile(null), []);

  const files = data?.files.edges.map((edge) => edge.node) || [];

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/feed">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Content</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent className="gap-4 p-0">
        <MemoryHubShell>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {loading && files.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading content…</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {files.map((file) => (
                  <GridItem key={file.id} file={file} onSelect={setSelectedFile} />
                ))}
              </div>
            )}

            <FileModal fileId={selectedFile ?? null} onClose={handleClose} />
          </div>
        </MemoryHubShell>
      </PageContent>
    </>
  );
}
