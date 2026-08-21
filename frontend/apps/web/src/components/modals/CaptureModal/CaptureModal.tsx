import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Camera } from '@ci/capture';
import { FetchJsonError, fetchJson, useDeviceLayout } from '@ci/common';
import { Button, Dialog, cn, IconButton, Popover, useToast } from '@ci/shadcn';
import {
  Camera as CameraIcon,
  FileUp,
  Images,
  Mic,
  Send,
  Settings,
  Square,
  Video,
  X,
} from '@ci/shadcn/icons';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useUploadFile } from '@/api';
import type { File as FileData, Thread } from '@/api/types';
import { Chat, type FormData } from '@/components/Chat';
import { InlineModal } from '@/components/InlineModal';
import { ModelSelector } from '@/components/ModelSelector';
import { useAuth, useChatRequester, useModel } from '@/hooks';
import { capturePhoto, captureVideo, chooseFiles, chooseFromLibrary } from '@/lib/captureMedia';
import { enqueueMemoryUpload } from '@/lib/memoryUploadQueue';
import { pickFromUserDevice, pickPhotosFromLibrary } from '@/lib/pickPhotosFromLibrary';
import { canRecordAudio, startAudioRecording, type AudioRecordingSession } from '@/lib/recordAudio';
import { getMediaType } from '@/lib/utils';

interface Props {
  open?: boolean;
  onClose?: () => void;
}

type CaptureMode = 'photo' | 'video' | 'thing';

interface ModelCapabilitiesResponse {
  vision: boolean;
}

export function CaptureModal({ open = false, onClose }: Props) {
  const { isMobile } = useDeviceLayout();

  // Wait for the breakpoint so the phone does not mount desktop chat hooks.
  if (isMobile == null) {
    return null;
  }

  // Phone: save captured media to Memory. Desktop keeps main's camera + chat.
  if (isMobile) {
    return <MobileMemoryCapture open={open} onClose={onClose} />;
  }

  return <DesktopCaptureModal open={open} onClose={onClose} />;
}

function DesktopCaptureModal({ open = false, onClose }: Props) {
  const { t } = useTranslation();
  const [{ authToken }] = useAuth();
  const [{ selectedVisionModel: selectedModel }] = useModel();
  const { toast } = useToast();

  const { isMobile } = useDeviceLayout();

  const [files, setFiles] = useState<FileData[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [selectedModelSupportsVision, setSelectedModelSupportsVision] = useState<boolean | null>(null);
  const [isCheckingModelCapabilities, setIsCheckingModelCapabilities] = useState(false);
  const [capabilityCheckFailed, setCapabilityCheckFailed] = useState(false);
  const modelVisionSupportCacheRef = useRef<Map<string, boolean>>(new Map());

  const [{ files: fileData }, { upload, reset: resetUploader }] = useUploadFile();

  const [
    { stream, loading, streaming, hasStartedReceiving },
    { submit: submitChatRequest, stop: stopChatRequest, detach: detachChatStream },
  ] = useChatRequester({
    threadId,
  });

  const handleClose = useCallback(() => {
    setFiles([]);
    setThreadId(null);
    resetUploader();
    detachChatStream();

    onClose?.();
  }, [onClose, resetUploader, detachChatStream]);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setThreadId(null);
    }
  }, [open]);

  useEffect(() => {
    if (authToken == null || selectedModel == null) {
      setSelectedModelSupportsVision(null);
      setCapabilityCheckFailed(false);
      setIsCheckingModelCapabilities(false);

      return;
    }

    const cachedSupport = modelVisionSupportCacheRef.current.get(selectedModel);

    if (cachedSupport != null) {
      setSelectedModelSupportsVision(cachedSupport);
      setCapabilityCheckFailed(false);
      setIsCheckingModelCapabilities(false);

      return;
    }

    let canceled = false;

    setSelectedModelSupportsVision(null);
    setCapabilityCheckFailed(false);
    setIsCheckingModelCapabilities(true);

    (async () => {
      try {
        const query = new URLSearchParams({ model: selectedModel }).toString();

        const response = await fetchJson<ModelCapabilitiesResponse>(`/api/llm/models/capabilities?${query}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (canceled || !response) {
          return;
        }

        modelVisionSupportCacheRef.current.set(selectedModel, response.vision);
        setSelectedModelSupportsVision(response.vision);
      } catch {
        if (canceled) {
          return;
        }

        setCapabilityCheckFailed(true);
        setSelectedModelSupportsVision(false);
      } finally {
        if (!canceled) {
          setIsCheckingModelCapabilities(false);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [authToken, selectedModel]);

  const ensureImageModelSupported = useCallback((): boolean => {
    if (selectedModel == null) {
      toast.error('Select a model before capturing images.');

      return false;
    }

    if (capabilityCheckFailed) {
      toast.error('Unable to verify model image support right now. Try again.');

      return false;
    }

    if (isCheckingModelCapabilities || selectedModelSupportsVision == null) {
      toast.error('Checking selected model capabilities. Try again in a moment.');

      return false;
    }

    if (!selectedModelSupportsVision) {
      toast.error('Selected model does not support image input. Choose a vision model.');

      return false;
    }

    return true;
  }, [capabilityCheckFailed, isCheckingModelCapabilities, selectedModel, selectedModelSupportsVision, toast]);

  const handleCapturedMedia = useCallback(
    async (file: File, mode: CaptureMode) => {
      const isImage = file.type.startsWith('image/');

      if (isImage && !ensureImageModelSupported()) {
        return;
      }

      const thingCapture = isImage && mode === 'thing';
      const uploaded = await upload([file], {
        thingCapture,
        model: selectedModel ?? undefined,
      });

      if (thingCapture && uploaded) {
        toast.success('Thing analysis started. This may take a moment.');
      }
    },
    [ensureImageModelSupported, selectedModel, toast, upload],
  );

  const handleMobileFrameCaptured = useCallback(
    async (file: File, mode: CaptureMode) => {
      if (!ensureImageModelSupported()) {
        return;
      }

      const thingCapture = mode === 'thing';
      const uploaded = await upload([file], {
        thingCapture,
        model: selectedModel ?? undefined,
      });

      if (thingCapture && uploaded) {
        toast.success('Thing analysis started. This may take a moment.');
      }
    },
    [ensureImageModelSupported, selectedModel, toast, upload],
  );

  const handleLibraryPick = useCallback(async () => {
    const picked = await pickPhotosFromLibrary({ multiple: true });

    for (const file of picked) {
      await handleCapturedMedia(file, 'photo');
    }
  }, [handleCapturedMedia]);

  const createFileThread = useCallback(async () => {
    const thread = await fetchJson<Thread>('/api/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        model: selectedModel,
      }),
    });

    if (thread) {
      setThreadId(thread.id);
    }
  }, [authToken, selectedModel]);

  useEffect(() => {
    (async () => {
      if (fileData.length === 0) {
        return;
      }

      // We do this with an additional user interaction on mobile, so skip here
      if (isMobile) {
        return;
      }

      // Check if this file is already in the files array to prevent duplicates
      setFiles((current) => {
        const alreadyExists = current.some((file) => file.id === fileData[0].id);

        if (alreadyExists) {
          return current;
        }

        return [...current, fileData[0]];
      });

      // Only create thread if we don't have one yet
      if (threadId == null) {
        await createFileThread();
      }
    })();
  }, [fileData, isMobile, createFileThread, threadId]);

  const handleSelectLastCapture = useCallback(async () => {
    if (fileData.length === 0) {
      return;
    }

    // Only create thread if we don't have one yet
    if (threadId == null) {
      await createFileThread();
    }

    // Check if this file is already in the files array to prevent duplicates
    setFiles((current) => {
      const alreadyExists = current.some((file) => file.id === fileData[0].id);

      if (alreadyExists) {
        return current;
      }

      return [...current, fileData[0]];
    });
  }, [fileData, createFileThread, threadId]);

  const handleSubmit = useCallback(
    async (data: FormData, e?: FormEvent) => {
      e?.preventDefault();

      const fileIds = files.map((file) => file.id);

      return submitChatRequest({ ...data, fileIds });
    },
    [files, submitChatRequest],
  );

  if (isMobile) {
    if (files.length === 0) {
      return (
        <InlineModal open={open} onClose={handleClose} className="fixed">
          <div className="absolute top-[env(safe-area-inset-top)] right-0 z-10">
            <div className="flex-1 text-right text-white">
              <IconButton
                label="Choose from library"
                variant="ghost"
                size="icon"
                onClick={() => void handleLibraryPick()}
              >
                <Images />
              </IconButton>
              <IconButton label={t('COMMON_CLOSE')} variant="ghost" size="icon" onClick={handleClose}>
                <X />
              </IconButton>
            </div>
          </div>

          <Camera
            onFrameCaptured={handleMobileFrameCaptured}
            onRecordingFinished={handleCapturedMedia}
            className="h-full"
          >
            <Camera.Feed />
            <div className="absolute w-full bottom-0">
              <Camera.MobileControls onSelectLastCapture={handleSelectLastCapture} />
            </div>
          </Camera>
        </InlineModal>
      );
    }

    return (
      <InlineModal open={open} onClose={handleClose}>
        <div className="flex flex-row items-center border-b bg-stone-50 dark:bg-secondary gap-2 p-2 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center flex-1">
            <Popover>
              <Popover.Trigger asChild>
                <IconButton
                  label={t('CAPTURE_MODEL_SETTINGS')}
                  className="flex-1"
                  variant="ghost"
                  size="icon"
                >
                  <Settings />
                </IconButton>
              </Popover.Trigger>
              <Popover.Content className="p-2 relative left-2 w-auto">
                <ModelSelector withToggles visionOnly />
              </Popover.Content>
            </Popover>
          </div>

          <div className="flex items-center justify-center font-bold">{fileData[0]?.name}</div>

          <div className="flex items-center justify-end flex-1">
            <IconButton label={t('COMMON_CLOSE')} variant="ghost" size="icon" onClick={handleClose}>
              <X />
            </IconButton>
          </div>
        </div>

        <Chat
          placeholder="Ask about this content..."
          loading={loading}
          streaming={streaming}
          hasStartedReceiving={hasStartedReceiving}
          readable={stream ?? undefined}
          onSubmit={handleSubmit}
          onStop={stopChatRequest}
          showModelControls={false}
        >
          <Files files={files} />
        </Chat>
      </InlineModal>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <Dialog.Content
        className={cn(
          'w-[90vw] h-[90vh] sm:max-w-[90vw] sm:max-h-[80vh] p-0 flex flex-col gap-0',
          files.length > 0 && 'max-[900px]:h-[80vh]',
        )}
        showCloseButton={false}
      >
        <Dialog.Header className="flex flex-row items-center justify-between border-b bg-stone-50 dark:bg-secondary rounded-t-lg gap-2 p-2 pl-4">
          <Dialog.Title className="flex-1">Upload Images and Videos</Dialog.Title>
          <Dialog.Description className="hidden">Capture audio or video and upload to CI</Dialog.Description>

          <IconButton
            label="Choose from library"
            variant="ghost"
            size="icon"
            onClick={() => void handleLibraryPick()}
          >
            <Images />
          </IconButton>

          <ModelSelector withToggles visionOnly />

          <div className="flex items-center justify-end">
            <IconButton label={t('COMMON_CLOSE')} variant="ghost" size="icon" onClick={handleClose}>
              <X />
            </IconButton>
          </div>
        </Dialog.Header>

        {files.length === 0 && (
          <Camera
            onFrameCaptured={handleCapturedMedia}
            onRecordingFinished={handleCapturedMedia}
            className="h-full"
          >
            <Camera.Information />
            <Camera.Feed />
            <Camera.DesktopControls />
          </Camera>
        )}

        {files.length > 0 && (
          <div className="flex flex-col flex-1 min-[900px]:flex-row min-h-0 min-w-0">
            {/* Left side: file preview or fallback */}
            <div className="flex max-[900px]:max-h-1/2">
              <div className="flex flex-col gap-4 p-2 min-[900px]:border-r max-w-[480px] w-full overflow-y-auto m-auto h-full min-h-0">
                <Files files={files} />
              </div>
            </div>

            <div className="flex-1 margin-4 min-w-0 max-[900px]:max-h-1/2 max-[900px]:border-t max-[900px]:pt-1">
              <Chat
                loading={loading}
                streaming={streaming}
                hasStartedReceiving={hasStartedReceiving}
                readable={stream ?? undefined}
                onSubmit={handleSubmit}
                onStop={stopChatRequest}
                showModelControls={false}
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
          </div>
        )}
      </Dialog.Content>
    </Dialog>
  );
}

function Files({ files }: { files?: FileData[] | null }) {
  if (files == null) {
    return null;
  }

  return (
    <>
      {files.map((file) => {
        const fileType = getMediaType(file.contentType);

        switch (fileType) {
          case 'video':
            return (
              <div key={file.id} className="aspect-video rounded-lg overflow-hidden bg-stone-100">
                <video controls className="w-full h-full object-cover">
                  <source src={`/static${file.url}`} type={file.contentType} />
                  Your browser does not support the video tag.
                </video>
              </div>
            );
          case 'audio':
            return (
              <div
                key={file.id}
                className="rounded-lg overflow-hidden bg-stone-100 p-4 flex items-center justify-center"
              >
                <audio controls className="w-full">
                  <source src={`/static${file.url}`} type={file.contentType} />
                  Your browser does not support the audio element.
                </audio>
              </div>
            );
          case 'image':
            return (
              <div key={file.id} className="rounded-lg bg-stone-100">
                <img src={`/static${file.url}`} className="w-full h-full object-cover" />
              </div>
            );
        }
      })}
    </>
  );
}

function fileLabel(files: File[]): string {
  if (files.length === 1) {
    return files[0].name;
  }

  return `${files.length} files`;
}

function MobileMemoryCapture({ open = false, onClose }: Props) {
  const { t } = useTranslation();
  const [{ authToken }] = useAuth();
  const [{ selectedVisionModel: selectedModel }] = useModel();
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);

  const ingest = useCallback(
    (files: File[], extra?: { inventoryCapture?: boolean }) => {
      if (files.length === 0) {
        return;
      }

      toast.message(t('CAPTURE_SAVING', { name: fileLabel(files) }));

      void enqueueMemoryUpload(files, {
        authToken,
        model: extra?.inventoryCapture ? (selectedModel ?? undefined) : undefined,
        inventoryCapture: extra?.inventoryCapture,
      }).then(
        () => {
          toast.success(t('CAPTURE_SAVED'));
        },
        (error: unknown) => {
          const message = error instanceof FetchJsonError ? error.message : t('CAPTURE_SAVE_FAILED');

          toast.error(message);
        },
      );
    },
    [authToken, selectedModel, t, toast],
  );

  const handlePhoto = useCallback(async () => {
    const file = await capturePhoto();

    if (file) {
      ingest([file]);
    }
  }, [ingest]);

  const handleVideo = useCallback(async () => {
    const file = await captureVideo();

    if (file) {
      ingest([file]);
    }
  }, [ingest]);

  const handleLibrary = useCallback(async () => {
    ingest(await chooseFromLibrary());
  }, [ingest]);

  const handleFiles = useCallback(async () => {
    ingest(await chooseFiles());
  }, [ingest]);

  const handleAudioFiles = useCallback(async () => {
    ingest(await pickFromUserDevice({ accept: 'audio/*', multiple: true }));
  }, [ingest]);

  const handleStartAudio = useCallback(() => {
    if (canRecordAudio()) {
      setRecording(true);

      return;
    }

    void handleAudioFiles();
  }, [handleAudioFiles]);

  useEffect(() => {
    if (!open) {
      setRecording(false);
    }
  }, [open]);

  return (
    <InlineCaptureShell open={open} onClose={onClose} title={t('CAPTURE_TITLE')}>
      {recording ? (
        <AudioRecorderPanel
          onComplete={(file) => {
            setRecording(false);
            ingest([file]);
          }}
          onCancel={() => setRecording(false)}
        />
      ) : (
        <CaptureActions
          onPhoto={() => void handlePhoto()}
          onVideo={() => void handleVideo()}
          onLibrary={() => void handleLibrary()}
          onFiles={() => void handleFiles()}
          onAudio={handleStartAudio}
        />
      )}
    </InlineCaptureShell>
  );
}

function InlineCaptureShell({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  return createPortal(
    <div data-testid="capture-shell" className="fixed inset-0 z-[100] bg-zinc-950 text-white">
      <div className="flex items-center justify-between px-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="px-3 text-lg font-semibold">{title}</h1>
        <IconButton
          label={t('COMMON_CLOSE')}
          variant="ghost"
          size="icon"
          className="text-white"
          onClick={onClose}
        >
          <X />
        </IconButton>
      </div>
      {children}
    </div>,
    document.body,
  );
}

function CaptureActions({
  onPhoto,
  onVideo,
  onLibrary,
  onFiles,
  onAudio,
}: {
  onPhoto: () => void;
  onVideo: () => void;
  onLibrary: () => void;
  onFiles: () => void;
  onAudio: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-[calc(100%-3rem)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <p className="text-sm text-zinc-400 px-1 mb-6">{t('CAPTURE_SUBTITLE')}</p>

      <div className="grid grid-cols-2 gap-3">
        <ActionTile icon={CameraIcon} label={t('CAPTURE_PHOTO')} onClick={onPhoto} />
        <ActionTile icon={Video} label={t('CAPTURE_VIDEO')} onClick={onVideo} />
        <ActionTile icon={Mic} label={t('CAPTURE_AUDIO')} onClick={onAudio} />
        <ActionTile icon={FileUp} label={t('CAPTURE_FILES')} onClick={onFiles} />
      </div>

      <Button
        variant="secondary"
        className="mt-4 w-full h-12 rounded-2xl bg-white/10 text-white hover:bg-white/15 border-0"
        onClick={onLibrary}
      >
        <Images className="h-4 w-4" />
        {t('CAPTURE_LIBRARY')}
      </Button>

      <p className="mt-auto pt-6 text-center text-xs text-zinc-500">{t('CAPTURE_BACKGROUND_HINT')}</p>
    </div>
  );
}

function ActionTile({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof CameraIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 h-32 rounded-2xl bg-white/10 hover:bg-white/15 active:scale-[0.98] transition-transform text-white"
    >
      <Icon className="h-8 w-8" strokeWidth={1.5} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function AudioRecorderPanel({
  onComplete,
  onCancel,
}: {
  onComplete: (file: File) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [elapsed, setElapsed] = useState(0);
  const sessionRef = useRef<AudioRecordingSession | null>(null);
  const onCancelRef = useRef(onCancel);
  const toastRef = useRef(toast);
  const tRef = useRef(t);

  onCancelRef.current = onCancel;
  toastRef.current = toast;
  tRef.current = t;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        const session = await startAudioRecording();

        if (cancelled) {
          session.cancel();

          return;
        }

        sessionRef.current = session;
        timer = setInterval(() => setElapsed((value) => value + 1), 1000);
      } catch {
        if (!cancelled) {
          toastRef.current.error(tRef.current('CAPTURE_SAVE_FAILED'));
          onCancelRef.current();
        }
      }
    })();

    return () => {
      cancelled = true;

      if (timer) {
        clearInterval(timer);
      }

      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, []);

  const handleStop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;

    if (!session) {
      onCancel();

      return;
    }

    try {
      onComplete(await session.stop());
    } catch {
      toast.error(t('CAPTURE_SAVE_FAILED'));
      onCancel();
    }
  }, [onCancel, onComplete, t, toast]);

  const handleCancel = useCallback(() => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    onCancel();
  }, [onCancel]);

  const minutes = Math.floor(elapsed / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-6">
      <div className="flex items-center gap-3 text-red-400">
        <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-medium tracking-wide uppercase">{t('CAPTURE_RECORDING')}</span>
      </div>
      <div className="text-5xl font-light tabular-nums tracking-tight">
        {minutes}:{seconds}
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={handleCancel}>
          {t('CAPTURE_CANCEL')}
        </Button>
        <Button onClick={() => void handleStop()}>
          <Square className="h-3 w-3 fill-current" />
          {t('CAPTURE_STOP')}
        </Button>
      </div>
    </div>
  );
}
