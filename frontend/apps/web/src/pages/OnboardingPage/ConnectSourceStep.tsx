import { useState } from 'react';

import { Dialog } from '@ci/shadcn';
import {
  AppWindow,
  Bookmark,
  Download,
  History,
  Monitor,
  MousePointerClick,
  Package,
  Search,
  Smartphone,
} from '@ci/shadcn/icons';

import { ProviderConnectDialog } from '@/components/connect/ProviderConnectDialog';
import { ServiceIntegrationsSection } from '@/components/connect/ServiceIntegrationsSection';
import { SourceCard, type TrackedObject } from '@/components/connect/SourceCard';
import { ImportSurface } from '@/pages/ImportPage/ImportPage';

import { CAPTURE_DOWNLOAD_URL, CHROME_EXTENSION_URL, CI_DOWNLOAD_URL } from './constants';
import { StepHeader } from './StepHeader';

/** Same cards, same lists, as `/sources` — so setup and the page do not diverge. */
const BROWSER_TRACKS: readonly TrackedObject[] = [
  { icon: History, label: 'Browsing history' },
  { icon: Bookmark, label: 'Bookmarks' },
  { icon: Search, label: 'Searches' },
];

const CAPTURE_TRACKS: readonly TrackedObject[] = [
  { icon: Monitor, label: 'Screen context' },
  { icon: AppWindow, label: 'App usage' },
  { icon: MousePointerClick, label: 'Desktop activity' },
];

export function ConnectSourceStep() {
  const [dialogProviderId, setDialogProviderId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const openDownload = () => window.open(CI_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  const openCaptureDownload = () => window.open(CAPTURE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');

  return (
    <div className="space-y-6 w-full mx-auto">
      <StepHeader title="Connect a source" description="Pull your email and calendar in automatically." />

      <ServiceIntegrationsSection
        variant="onboarding"
        disabledWhenConnected
        onProviderSelect={(rawId) => setDialogProviderId(rawId)}
      />

      <div className="space-y-4 max-w-5xl mx-auto w-full">
        <p className="text-lg sm:text-xl leading-snug text-muted-foreground text-center px-2">
          Want your memory to include desktop or mobile browser history? Get the browser extension.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          <SourceCard
            logo="/branding/chrome/logo.svg"
            name="Chrome"
            tracks={BROWSER_TRACKS}
            onSelect={() => window.open(CHROME_EXTENSION_URL, '_blank', 'noopener,noreferrer')}
          />
          <SourceCard logo="/branding/firefox/logo.svg" name="Firefox" tracks={BROWSER_TRACKS} comingSoon />
          <SourceCard
            logo="/branding/ios/logo.svg"
            name="iPhone & iPad"
            tracks={[
              { icon: Smartphone, label: 'Mobile browsing' },
              { icon: AppWindow, label: 'App usage' },
              { icon: History, label: 'Screen time' },
            ]}
            onSelect={openDownload}
          />
        </div>
      </div>

      <div className="space-y-4 max-w-5xl mx-auto w-full">
        <p className="text-lg sm:text-xl leading-snug text-muted-foreground">
          Have local exports? Import tools can seed your memory faster.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
          <SourceCard
            icon={<Download aria-hidden className="h-full w-full" strokeWidth={1.5} />}
            name="An export you already have"
            tracks={[
              { icon: Package, label: 'Google Takeout' },
              { icon: Package, label: 'Apple privacy download' },
              { icon: Package, label: 'And dozens more' },
            ]}
            onSelect={() => setImportOpen(true)}
          />
        </div>
      </div>

      {/* The import surface comes to the user as a dialog rather than
          navigating to /import: the onboarding gate bounces main-app routes
          straight back here, and a dialog dismisses back into the step so
          onboarding can be finished. */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <Dialog.Content className="flex h-[85vh] flex-col overflow-hidden sm:max-w-5xl [&>button]:cursor-pointer">
          <Dialog.Header>
            <Dialog.Title>Import your data</Dialog.Title>
            <Dialog.Description>
              Everything you import stays on this appliance. Close this any time to finish setting up.
            </Dialog.Description>
          </Dialog.Header>
          <ImportSurface variant="onboarding" />
        </Dialog.Content>
      </Dialog>

      <div className="space-y-4 max-w-5xl mx-auto w-full">
        <p className="text-lg sm:text-xl leading-snug text-muted-foreground text-center px-2">
          On the computer you use most, download Companion Capture. It streams screenshots and activity logs
          into your memory.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          <SourceCard
            logo="/branding/mac/logo.svg"
            name="macOS"
            tracks={CAPTURE_TRACKS}
            onSelect={openCaptureDownload}
          />
          <SourceCard
            logo="/branding/windows/logo.svg"
            name="Windows"
            tracks={CAPTURE_TRACKS}
            onSelect={openCaptureDownload}
          />
          <SourceCard
            logo="/branding/linux/logo.svg"
            name="Linux"
            tracks={CAPTURE_TRACKS}
            onSelect={openCaptureDownload}
          />
        </div>
      </div>

      <ProviderConnectDialog
        rawProviderId={dialogProviderId}
        open={dialogProviderId != null}
        resumeOnboarding
        onOpenChange={(open) => {
          if (!open) {
            setDialogProviderId(null);
          }
        }}
        onConnected={() => {
          setDialogProviderId(null);
        }}
      />
    </div>
  );
}
