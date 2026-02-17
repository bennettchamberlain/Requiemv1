import { useMemo } from 'react';

import { useQuery } from '@apollo/client';
import { LoadingPage, Portal, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { File as FileIcon, Download } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';
import { type FragmentType, useFragment } from '@/graphql/fragment-masking';

const FileGridItemFragment = gql(`
  fragment FileGridItemFragment on FileType {
    id
    filename
    contentType
    sourceUrl
    previewUrl
    createdAt
  }
`);

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

function FileGridItem({ file: fileMasked }: { file: FragmentType<typeof FileGridItemFragment> }) {
  const file = useFragment(FileGridItemFragment, fileMasked);
  const isImage = file.contentType.startsWith('image/');
  const isVideo = file.contentType.startsWith('video/');

  const sourceUrl = useMemo(() => {
    return file.sourceUrl ? `/static${file.sourceUrl}` : undefined;
  }, [file.sourceUrl]);

  const previewUrl = useMemo(() => {
    return file.previewUrl ? `/static${file.previewUrl}` : undefined;
  }, [file.previewUrl]);

  if (isImage) {
    return (
      <div className="relative group aspect-square bg-muted rounded-lg overflow-hidden border border-border">
        <img src={previewUrl} alt={file.filename || ''} className="w-full h-full object-cover" />
        <a
          href={sourceUrl}
          download={file.filename}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
        >
          <Download className="w-6 h-6" />
        </a>
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="relative group aspect-square bg-muted rounded-lg overflow-hidden border border-border">
        <video src={sourceUrl} className="w-full h-full object-cover" controls />
      </div>
    );
  }

  return (
    <a
      href={sourceUrl}
      download={file.filename}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center justify-center aspect-square bg-muted rounded-lg p-4 hover:bg-muted/80 transition-colors border border-border group relative"
    >
      <FileIcon className="w-12 h-12 mb-2 text-muted-foreground" />
      <span className="text-sm text-center truncate w-full px-2 font-medium text-foreground">
        {file.filename}
      </span>
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white rounded-lg">
        <Download className="w-6 h-6" />
      </div>
    </a>
  );
}

export function FilesPage() {
  usePageTitle('Files - Companion Intelligence');

  const { data, loading } = useQuery(GET_FILES, {
    variables: { first: 50 },
  });

  if (loading) {
    return <LoadingPage />;
  }

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
              <Breadcrumb.Page>Files</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {files.map((file) => (
            <FileGridItem key={file.id} file={file} />
          ))}
        </div>
      </PageContent>
    </>
  );
}
