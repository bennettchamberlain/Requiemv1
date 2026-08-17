import { AppWindow, Bookmark, History, Monitor, MousePointerClick, Search } from '@ci/shadcn/icons';

import { ConnectedAccountsSection } from '@/components/connect/ConnectedAccountsSection';
import { ServiceIntegrationsSection } from '@/components/connect/ServiceIntegrationsSection';
import { SourceCard, type TrackedObject } from '@/components/connect/SourceCard';

const CAPTURE_DOWNLOAD_URL = 'https://ci.computer/download#capture';

const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/companion-intelligence/bcocflgkdeimninckpmdifcniajoneih?authuser=3&hl=en';

/** Every browser extension hands over the same three things. */
const BROWSER_TRACKS: readonly TrackedObject[] = [
  { icon: History, label: 'Browsing history' },
  { icon: Bookmark, label: 'Bookmarks' },
  { icon: Search, label: 'Searches' },
];

/** As does Capture, on whichever desktop you install it on. */
const CAPTURE_TRACKS: readonly TrackedObject[] = [
  { icon: Monitor, label: 'Screen context' },
  { icon: AppWindow, label: 'App usage' },
  { icon: MousePointerClick, label: 'Desktop activity' },
];

/**
 * The live half of Sources: everything that keeps sending data once set up.
 *
 * Service integrations lead, because signing into Gmail is the shortest path
 * from an empty appliance to a populated one. The extension and Capture follow:
 * both are real sources, but both need software installed somewhere else, so
 * they are a second decision rather than the first one.
 *
 * All three grids use the same card, and each card is a name and a list of what
 * that source hands over. Uniform on purpose: the question on this page is
 * always "what would adding this give me", and it should be answered in the
 * same place and the same shape whatever kind of source you are looking at.
 *
 * What is already connected sits above all of it — this was `/connections`,
 * and it reads as status rather than as its own destination.
 */
export function ConnectPanel() {
  const openCaptureDownload = () => window.open(CAPTURE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');

  return (
    <div className="w-full">
      <ConnectedAccountsSection />

      {/* The cards name what each source hands over, so the standfirsts no
          longer list it too. What is left is the part they cannot say. */}
      <section className="mx-auto mb-8 w-full max-w-[1280px]">
        <h2 className="mb-1 text-2xl font-bold">Services</h2>
        <p className="text-muted-foreground mb-6">
          Sign in once; Companion keeps pulling on its own. Nothing leaves this appliance.
        </p>
        <ServiceIntegrationsSection variant="page" />
      </section>

      <section className="mx-auto mb-8 w-full max-w-[1280px]">
        <h2 className="mb-1 text-2xl font-bold">Browser extensions</h2>
        <p className="text-muted-foreground mb-6">
          The pages you read are the part of your day no service exports.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          <SourceCard
            logo="/branding/chrome/logo.svg"
            name="Chrome"
            tracks={BROWSER_TRACKS}
            onSelect={() => window.open(CHROME_EXTENSION_URL, '_blank', 'noopener,noreferrer')}
          />
          <SourceCard logo="/branding/firefox/logo.svg" name="Firefox" tracks={BROWSER_TRACKS} comingSoon />
          <SourceCard logo="/branding/safari/logo.svg" name="Safari" tracks={BROWSER_TRACKS} comingSoon />
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1280px]">
        <h2 className="mb-1 text-2xl font-bold">Companion Capture</h2>
        <p className="text-muted-foreground mb-6">
          Install it on the machine you actually work on. Everything stays on your Hub.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
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
      </section>
    </div>
  );
}
