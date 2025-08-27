import { useCallback } from 'react';

import { Camera, getImageDataURL, getVideoPreviewDataURL } from '@ci/capture';
import { Dialog, useToast } from '@ci/shadcn';
import { Send } from '@ci/shadcn/icons';

import type { File as CIFile } from '@/api/types.ts';
import { Chat } from '@/components/Chat';
import { useAuth } from '@/hooks';
import { getMediaType } from '@/lib/utils';

interface Props {
  open?: boolean;
  files?: CIFile[];
  onClose?: () => void;
}

export function CaptureModal({ open = false, files = [], onClose }: Props) {
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose?.();
    }
  }, []);

  const [{ authToken }] = useAuth();
  const { toast } = useToast();

  const handleFrameCaptured = useCallback(async (file: File) => {
    const formData = new FormData();

    formData.append('file', file);

    const res = await fetch('/api/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });

    if (!res.ok) {
      throw new Error('Upload failed');
    }

    const dataUrl = await getImageDataURL(file);

    toast.custom((id) => (
      <div
        className="flex flex-col gap-1 p-4 bg-white border border-gray-200 rounded-md shadow-md"
        onClick={() => toast.dismiss(id)}
      >
        <div className="font-semibold text-sm text-gray-800">Image saved</div>
        <img src={dataUrl} alt="Saved image" />
      </div>
    ));
    // files.push();
  }, []);

  const handleRecordingFinished = useCallback(async (file: File) => {
    const formData = new FormData();

    formData.append('file', file);

    const res = await fetch('/api/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });

    if (!res.ok) {
      throw new Error('Upload failed');
    }

    const dataUrl = await getVideoPreviewDataURL(file);

    toast.custom((id) => (
      <div
        className="flex flex-col gap-1 p-4 bg-white border border-gray-200 rounded-md shadow-md"
        onClick={() => toast.dismiss(id)}
      >
        <div className="font-semibold text-sm text-gray-800">Video saved</div>
        <img src={dataUrl} alt="Preview of saved video" />
      </div>
    ));
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content className="sm:max-w-[70vw] max-h-[70vh] p-0 flex flex-col gap-0">
        <Dialog.Header className="flex flex-row items-center gap-4 p-4 pb-3 border-b bg-stone-50 rounded-t-2xl">
          <Dialog.Title>Upload Images and Videos</Dialog.Title>
          <Dialog.Description className="hidden">Capture audio or video and upload to CI</Dialog.Description>
        </Dialog.Header>

        {files.length === 0 && (
          <Camera onFrameCaptured={handleFrameCaptured} onRecordingFinished={handleRecordingFinished}>
            <div>
              <Camera.Feed />
            </div>
          </Camera>
        )}
        {files.length > 0 && (
          <div className="flex flex-1">
            {/* Left side: file preview or fallback */}
            <div className="flex flex-col gap-4 p-4 border-r min-w-[320px] max-w-[480px] w-full">
              {files.map((file) => {
                const fileType = getMediaType(file.contentType);
                switch (fileType) {
                  case 'video':
                    return (
                      <div className="aspect-video rounded-lg overflow-hidden bg-stone-100">
                        <video controls className="w-full h-full object-cover">
                          <source src={file.url} type={file.contentType} />
                          Your browser does not support the video tag.
                        </video>
                      </div>
                    );
                  case 'audio':
                    return (
                      <div className="rounded-lg overflow-hidden bg-stone-100 p-4 flex items-center justify-center">
                        <audio controls className="w-full">
                          <source src={file.url} type={file.contentType} />
                          Your browser does not support the audio element.
                        </audio>
                      </div>
                    );
                  case 'image':
                    return (
                      <div className="aspect-video rounded-lg overflow-hidden bg-stone-100">
                        <img src={file.url} className="w-full h-full object-cover" />
                      </div>
                    );
                }
              })}
            </div>

            {/* Right side: Chat */}
            {files?.length > 0 && (
              <div className="flex-1 min-w-0">
                <Chat
                  placeholder="Ask about this content..."
                  emptyState={
                    <div className="text-center text-gray-500 mt-8">
                      <div className="w-16 h-16 mx-auto mb-4 bg-stone-100 rounded-full flex items-center justify-center">
                        <Send className="w-8 h-8 text-zinc-400 relative top-0.5 -left-0.5" />
                      </div>
                      <p className="text-sm">Start a conversation about this content</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Ask questions, get recommendations, or explore ideas
                      </p>
                    </div>
                  }
                />
              </div>
            )}
          </div>
        )}
      </Dialog.Content>
    </Dialog>
  );
}
