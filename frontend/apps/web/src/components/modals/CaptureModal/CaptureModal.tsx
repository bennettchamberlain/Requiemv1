import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Camera } from '@ci/capture';
import { FetchJsonError, useDeviceLayout } from '@ci/common';
import { Button, Dialog, IconButton, useToast } from '@ci/shadcn';
import { Camera as CameraIcon, FileUp, Images, Mic, Square, Video, X } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

import { useAuth, useModel } from '@/hooks';
import { capturePhoto, captureVideo, chooseFiles, chooseFromLibrary } from '@/lib/captureMedia';
import { enqueueMemoryUpload } from '@/lib/memoryUploadQueue';
import { pickFromUserDevice } from '@/lib/pickPhotosFromLibrary';
import { canRecordAudio, startAudioRecording, type AudioRecordingSession } from '@/lib/recordAudio';

interface Props {
  open?: boolean;
  onClose?: () => void;
}

function fileLabel(files: File[]): string {
  if (files.length === 1) {
    return files[0].name;
  }

  return `${files.length} files`;
}

export function CaptureModal({ open = false, onClose }: Props) {
  const { t } = useTranslation();
  const [{ authToken }] = useAuth();
  const [{ selectedVisionModel: selectedModel }] = useModel();
  const { toast } = useToast();
  const { isMobile } = useDeviceLayout();
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

  const handleDesktopCapture = useCallback(
    (file: File, mode: 'photo' | 'video' | 'inventory') => {
      ingest([file], { inventoryCapture: mode === 'inventory' });
    },
    [ingest],
  );

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

  if (isMobile) {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose?.();
        }
      }}
    >
      <Dialog.Content
        className="w-[90vw] h-[90vh] sm:max-w-[90vw] sm:max-h-[80vh] p-0 flex flex-col gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <Dialog.Header className="flex flex-row items-center justify-between border-b bg-stone-50 dark:bg-secondary rounded-t-lg gap-2 p-2 pl-4">
          <Dialog.Title className="flex-1">{t('CAPTURE_TITLE')}</Dialog.Title>
          <Dialog.Description className="hidden">{t('CAPTURE_SUBTITLE')}</Dialog.Description>

          <IconButton label={t('CAPTURE_LIBRARY')} variant="ghost" size="icon" onClick={() => void handleLibrary()}>
            <Images />
          </IconButton>
          <IconButton label={t('CAPTURE_FILES')} variant="ghost" size="icon" onClick={() => void handleFiles()}>
            <FileUp />
          </IconButton>
          <IconButton label={t('CAPTURE_AUDIO')} variant="ghost" size="icon" onClick={handleStartAudio}>
            <Mic />
          </IconButton>

          <IconButton label={t('COMMON_CLOSE')} variant="ghost" size="icon" onClick={onClose}>
            <X />
          </IconButton>
        </Dialog.Header>

        <div className="relative flex-1 min-h-0 bg-black">
          {recording ? (
            <div className="absolute inset-0 z-20 bg-black">
              <AudioRecorderPanel
                onComplete={(file) => {
                  setRecording(false);
                  ingest([file]);
                }}
                onCancel={() => setRecording(false)}
              />
            </div>
          ) : (
            <Camera
              onFrameCaptured={handleDesktopCapture}
              onRecordingFinished={handleDesktopCapture}
              className="h-full"
            >
              <Camera.Information />
              <Camera.Feed />
              <Camera.DesktopControls />
            </Camera>
          )}
        </div>

        <p className="text-xs text-muted-foreground px-4 py-2 border-t">{t('CAPTURE_BACKGROUND_HINT')}</p>
      </Dialog.Content>
    </Dialog>
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

  // Portal out of the phone header (`z-20`). A `fixed` child of that header
  // stays in its stacking context, so the Add button's tooltip (portaled to
  // `document.body` at `z-50`) paints on top of Capture.
  return createPortal(
    <div data-testid="capture-shell" className="fixed inset-0 z-[100] bg-zinc-950 text-white">
      <div className="flex items-center justify-between px-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="px-3 text-lg font-semibold">{title}</h1>
        <IconButton label={t('COMMON_CLOSE')} variant="ghost" size="icon" className="text-white" onClick={onClose}>
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

function AudioRecorderPanel({ onComplete, onCancel }: { onComplete: (file: File) => void; onCancel: () => void }) {
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
