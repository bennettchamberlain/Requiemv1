import { type ReactNode } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { useParams, Link } from 'react-router-dom';

import { FileIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

const GET_FILE = gql(`
  query GetFile($id: ID!) {
    file(id: $id) {
      id
      originalName
      url
    }
  }
`);

export function FilePage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_FILE, {
    variables: {
      id: GlobalUID.encode('file', id!),
    },
  });

  const file = data?.file;

  usePageTitle(
    file?.originalName
      ? `File - ${file.originalName} - Companion Intelligence`
      : 'File - Companion Intelligence',
  );

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (file == null) {
    content = <EmptyState icon={<FileIcon size={48} colorized={false} />} message="File not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center gap-2">
          <FileIcon />
          <h1 className="text-2xl font-bold break-all">{file.originalName}</h1>
        </div>
        <div>
          {/* Display image if url is an image, otherwise just link */}
          <img src={file.url} alt="File content" className="max-w-full h-auto mt-4 rounded-md" />
        </div>
      </PageContent>
    );
  }

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

            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Page>File</Breadcrumb.Page>
            </Breadcrumb.Item>

            {file && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page className="max-w-[200px] truncate">{file.originalName}</Breadcrumb.Page>
                </Breadcrumb.Item>
              </>
            )}
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      {content}
    </>
  );
}
