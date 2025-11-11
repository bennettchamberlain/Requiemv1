import { useCallback, useEffect, useRef, useState } from 'react';

import { Portal } from '@ci/common';
import { Button, DropdownMenu, Separator } from '@ci/shadcn';
import { Upload, Camera, Plus } from '@ci/shadcn/icons';

import { useUploadFile } from '@/api';
import { CaptureModal } from '@/components/modals/CaptureModal';
import { UploadModal } from '@/components/modals/UploadModal';
import { useModalControls } from '@/hooks';

import { NavUser } from './NavUser';

export function PrimaryNavigation() {
  const [{ isOpen: isCaptureModalOpen }, { open: openCaptureModal, close: closeCaptureModal }] =
    useModalControls();
  const [{ isOpen: isUploadModalOpen }, { open: openUploadModal, close: closeUploadModal }] =
    useModalControls();

  const [, { upload, reset: resetUploader }] = useUploadFile();

  const [hasActions, setHasActions] = useState(false);
  const observer = useRef<MutationObserver | null>(null);

  const actionsRef = useCallback((node: HTMLDivElement | null) => {
    if (observer.current) {
      observer.current.disconnect();
      observer.current = null;
    }

    if (node) {
      observer.current = new MutationObserver(() => {
        setHasActions(node.childElementCount > 0);
      });

      observer.current.observe(node, { childList: true });

      setHasActions(node.childElementCount > 0);
    }
  }, []);

  useEffect(() => {
    return () => {
      observer.current?.disconnect();
    };
  }, []);

  const handleUpload = (files: FileList) => {
    return upload(Array.from(files));
  };

  return (
    <>
      <header className="flex flex-row items-center justify-between p-2 px-4">
        <section className="flex flex-row items-center">
          <Portal id="breadcrumbs" />
        </section>

        <section className="flex flex-row items-center gap-4">
          <Portal ref={actionsRef} id="actions" className="flex flex-row items-center" />

          {hasActions && (
            <Separator orientation="vertical" className="data-[orientation=vertical]:h-8 -mr-2" />
          )}

          <div className="flex flex-row items-center gap-2">
            <DropdownMenu modal={false}>
              <DropdownMenu.Trigger asChild>
                <Button variant="ghost" size="icon" aria-label="More Options">
                  <Plus />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="min-w-42 rounded-lg" side="bottom" align="end" sideOffset={4}>
                <DropdownMenu.Group>
                  <DropdownMenu.Item onSelect={openUploadModal}>
                    <Upload />
                    Upload
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={openCaptureModal}>
                    <Camera />
                    Capture
                  </DropdownMenu.Item>
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu>

            <NavUser />
          </div>
        </section>
      </header>

      <UploadModal
        open={isUploadModalOpen}
        onClose={() => {
          resetUploader();
          closeUploadModal();
        }}
        onSubmit={handleUpload}
      />

      <CaptureModal
        open={isCaptureModalOpen}
        onClose={() => {
          resetUploader();
          closeCaptureModal();
        }}
      />
    </>
  );
}
