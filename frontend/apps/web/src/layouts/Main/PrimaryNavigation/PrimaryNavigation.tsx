import { useState } from 'react';

import { Portal } from '@ci/common';
import { Button, DropdownMenu, Separator, Sidebar } from '@ci/shadcn';
import { MoreHorizontal, SunMoon, Upload, Camera } from '@ci/shadcn/icons';

import { useUploadFile } from '@/api';
import { CaptureModal } from '@/components/modals/CaptureModal';
import { UploadModal } from '@/components/modals/UploadModal';
import { useModalControls, useTheme } from '@/hooks';

export function PrimaryNavigation() {
  const { themeState, setTheme } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [{ isOpen: isCaptureModalOpen }, { open: openCaptureModal, close: closeCaptureModal }] =
    useModalControls();
  const [{ isOpen: isUploadModalOpen }, { open: openUploadModal, close: closeUploadModal }] =
    useModalControls();

  const [, { upload, reset: resetUploader }] = useUploadFile();

  const handleUpload = (files: FileList) => {
    return upload(Array.from(files));
  };

  return (
    <>
      <header className="flex flex-row items-center justify-between pl-2 pr-4 py-2 border-b">
        <section className="flex flex-row items-center">
          <Sidebar.Trigger />
          <Separator orientation="vertical" className="ml-2 mr-3 data-[orientation=vertical]:h-5" />
          <Portal id="breadcrumbs" />
        </section>

        <section className="flex flex-row items-center gap-2">
          <Portal id="actions" className="flex flex-row items-center" />

          <div className="flex flex-row items-center">
            <Portal id="contextual-button" />
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenu.Trigger asChild>
                <Button variant="outline" size="icon" aria-label="More Options">
                  <MoreHorizontal />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" className="w-52">
                <DropdownMenu.Group>
                  <DropdownMenu.Item
                    onClick={() => {
                      setMenuOpen(false);
                      openUploadModal();
                    }}
                  >
                    <Upload />
                    Upload
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onClick={() => {
                      setMenuOpen(false);
                      openCaptureModal();
                    }}
                  >
                    <Camera />
                    Capture
                  </DropdownMenu.Item>
                </DropdownMenu.Group>

                <DropdownMenu.Separator />

                <DropdownMenu.Group>
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger>
                      <SunMoon />
                      Set theme
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent>
                      <DropdownMenu.RadioGroup
                        value={themeState.mode}
                        onValueChange={(value: string) => setTheme(value as 'light' | 'dark' | 'system')}
                      >
                        <DropdownMenu.RadioItem value="light">Light</DropdownMenu.RadioItem>
                        <DropdownMenu.RadioItem value="dark">Dark</DropdownMenu.RadioItem>
                        <DropdownMenu.RadioItem value="system">System</DropdownMenu.RadioItem>
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Sub>
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu>
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
