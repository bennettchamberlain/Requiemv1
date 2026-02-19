import { useMemo } from 'react';

import { useQuery } from '@apollo/client';
import { Dialog } from '@ci/shadcn';
import { Download, Loader2, X } from '@ci/shadcn/icons';

import { gql } from '@/graphql';

const GET_FILE_MEDIA = gql(`
  query GetFileMedia($id: ID!) {
    file(id: $id) {
      id
      filename
      contentType
      sourceUrl
    }
  }
`);

export function MediaModal({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const { data, loading } = useQuery(GET_FILE_MEDIA, {
    variables: { id: fileId! },
    skip: fileId == null,
    fetchPolicy: 'cache-first',
  });

  const file = data?.file ?? null;
  const open = fileId !== null;

  const sourceUrl = useMemo(() => {
    return file?.sourceUrl ? `/static${file.sourceUrl}` : undefined;
  }, [file?.sourceUrl]);

  const isVideo = file?.contentType.startsWith('video/') ?? false;
  const isImage = file?.contentType.startsWith('image/') ?? false;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Content
        showCloseButton={false}
        className="w-fit max-w-[95vw] p-0 gap-0 overflow-hidden border-none bg-transparent rounded-xl shadow-2xl"
      >
        <Dialog.Header className="sr-only">
          <Dialog.Title>{file?.filename || 'Preview'}</Dialog.Title>
        </Dialog.Header>

        {/* Close button */}
        <Dialog.Close className="absolute top-3 right-3 z-10 rounded-full bg-black/60 p-2 text-white/80 hover:text-white hover:bg-black/80 transition-colors">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </Dialog.Close>

        {/* Media content */}
        <div className="flex items-center justify-center max-h-[85vh]">
          {loading ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <Loader2 className="h-8 w-8 animate-spin text-white/60" />
            </div>
          ) : (
            <>
              {isVideo && sourceUrl && (
                <video src={sourceUrl} className="max-w-full max-h-[85vh] rounded-t-xl" controls autoPlay />
              )}
              {isImage && sourceUrl && (
                <img
                  src={sourceUrl}
                  alt={file?.filename || ''}
                  className="max-w-full max-h-[85vh] object-contain rounded-t-xl"
                />
              )}
            </>
          )}
        </div>

        {/* Footer bar */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-background border-t border-border">
          <span className="text-sm font-medium truncate min-w-0">{file?.filename || 'Untitled'}</span>
          <a
            href={sourceUrl}
            download={file?.filename ?? true}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 shrink-0 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
