import { useMemo } from 'react';

import { useQuery } from '@apollo/client';
import { Button, Dialog } from '@ci/shadcn';
import { Download, Loader2, X } from '@ci/shadcn/icons';

import { gql } from '@/graphql';

const GET_FILE_PREVIEW = gql(`
  query GetFilePreview($id: ID!) {
    file(id: $id) {
      id
      filename
      contentType
      sourceUrl
      previewUrl
      createdAt
    }
  }
`);

export function ImagePreviewModal({
  fileId,
  onClose,
}: {
  fileId: string | null;
  onClose: () => void;
}) {
  const { data, loading } = useQuery(GET_FILE_PREVIEW, {
    variables: { id: fileId! },
    skip: fileId == null,
    fetchPolicy: 'cache-first',
  });

  const file = data?.file ?? null;

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
    <Dialog open={fileId != null} onOpenChange={(open) => !open && onClose()}>
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
            {loading ? (
              <Loader2 className="h-8 w-8 animate-spin text-white/60" />
            ) : sourceUrl ? (
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

function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString();
}
