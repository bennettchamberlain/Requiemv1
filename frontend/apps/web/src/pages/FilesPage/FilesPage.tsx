import { useMemo, useState } from 'react';

import { useQuery } from '@apollo/client';
import { LoadingPage, Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Dialog } from '@ci/shadcn';
import { Download, Eye, File as FileIcon, X } from '@ci/shadcn/icons';
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

interface PreviewableImageFile {
  id: string;
  filename: string | null;
  contentType: string;
  sourceUrl: string | null;
  previewUrl: string | null;
  createdAt: string | Date;
}

function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString();
}

function FileGridItem({
  file: fileMasked,
  onImagePreview,
}: {
  file: FragmentType<typeof FileGridItemFragment>;
  onImagePreview: (file: PreviewableImageFile) => void;
}) {
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
      <button
        type="button"
        className="relative group aspect-square bg-muted rounded-lg overflow-hidden border border-border w-full cursor-zoom-in"
        onClick={() =>
          onImagePreview({
            id: file.id,
            filename: file.filename ?? null,
            contentType: file.contentType,
            sourceUrl: file.sourceUrl ?? null,
            previewUrl: file.previewUrl ?? null,
            createdAt: file.createdAt,
          })
        }
      >
        {previewUrl || sourceUrl ? (
          <img
            src={previewUrl ?? sourceUrl}
            alt={file.filename || ''}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <FileIcon className="w-8 h-8" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
          <Eye className="w-6 h-6" />
        </div>
      </button>
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

function ImagePreviewModal({ file, onClose }: { file: PreviewableImageFile | null; onClose: () => void }) {
  const sourceUrl = useMemo(() => {
    return file?.sourceUrl ? `/static${file.sourceUrl}` : undefined;
  }, [file?.sourceUrl]);

  const metadata = useMemo(() => {
    if (file == null) {
      return [];
    }

    return [
      { label: 'Filename', value: file.filename ?? 'Untitled' },
      { label: 'Content type', value: file.contentType },
      { label: 'Created', value: formatDateTime(file.createdAt) },
      { label: 'File ID', value: file.id },
    ];
  }, [file]);

  return (
    <Dialog open={file != null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content
        className="w-[95vw] max-w-[95vw] sm:max-w-[95vw] xl:max-w-[1400px] max-h-[95vh] p-0 flex flex-col gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <Dialog.Header className="flex flex-row items-center justify-between border-b bg-stone-50 dark:bg-secondary rounded-t-lg gap-2 p-2 pl-4">
          <div className="min-w-0">
            <Dialog.Title className="truncate">{file?.filename ?? 'Image preview'}</Dialog.Title>
            <Dialog.Description className="truncate">Preview and metadata</Dialog.Description>
          </div>

          <div className="flex items-center gap-2">
            {sourceUrl && (
              <a
                href={sourceUrl}
                download={file?.filename ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="ghost" size="icon" aria-label="Download file">
                  <Download />
                </Button>
              </a>
            )}
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X />
            </Button>
          </div>
        </Dialog.Header>

        <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] min-h-0">
          <div className="bg-black/90 flex items-center justify-center p-3 min-h-[50vh] h-[72vh]">
            {sourceUrl ? (
              <img
                src={sourceUrl}
                alt={file?.filename ?? 'Preview image'}
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-sm text-muted-foreground">No image source available.</div>
            )}
          </div>

          <div className="border-t md:border-t-0 md:border-l p-4 space-y-3 overflow-y-auto">
            {metadata.map((entry) => (
              <div key={entry.label}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{entry.label}</div>
                <div className="text-sm break-words">{entry.value}</div>
              </div>
            ))}
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

export function FilesPage() {
  usePageTitle('Files - Companion Intelligence');
  const [selectedImage, setSelectedImage] = useState<PreviewableImageFile | null>(null);

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
            <FileGridItem key={file.id} file={file} onImagePreview={setSelectedImage} />
          ))}
        </div>

        <ImagePreviewModal file={selectedImage} onClose={() => setSelectedImage(null)} />
      </PageContent>
    </>
  );
}
