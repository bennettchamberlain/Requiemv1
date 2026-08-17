import {
  AppWindow,
  Bookmark,
  History,
  Monitor,
  MonitorSmartphone,
  MousePointerClick,
  Search,
} from '@ci/shadcn/icons';

import { SourceCard, type TrackedObject } from '@/components/connect/SourceCard';

import { useDevices, type RegisteredDevice } from './useDevices';

export const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/companion-intelligence/bcocflgkdeimninckpmdifcniajoneih?authuser=3&hl=en';

export const CAPTURE_DOWNLOAD_URL = 'https://ci.computer/download#capture';

/** Every browser extension hands over the same three things. */
export const BROWSER_TRACKS: readonly TrackedObject[] = [
  { icon: History, label: 'Browsing history' },
  { icon: Bookmark, label: 'Bookmarks' },
  { icon: Search, label: 'Searches' },
];

/** As does Capture, on whichever desktop it runs. */
export const CAPTURE_TRACKS: readonly TrackedObject[] = [
  { icon: Monitor, label: 'Screen context' },
  { icon: AppWindow, label: 'App usage' },
  { icon: MousePointerClick, label: 'Desktop activity' },
];

/**
 * The devices path: everything you install rather than sign into.
 *
 * Browsers and desktops share one path because the appliance already treats
 * them as one thing — both register in the device table, `device_type:
 * 'browser'` alongside `laptop` and `desktop`, and both answer the same
 * question: which of my machines is feeding this, and is it still doing it.
 *
 * What has reported in leads, exactly as connected accounts lead the services
 * path, so the shape of every path on this page is the same: what you already
 * have, then what you could add.
 */
export function DevicesPanel() {
  const { devices, loading } = useDevices();

  return (
    <div className="w-full">
      {!loading && devices.length > 0 && (
        <section className="mx-auto mb-8 w-full max-w-[1280px]">
          <h2 className="mb-1 text-2xl font-bold">Your devices</h2>
          <p className="text-muted-foreground mb-6">Everything that has reported in, most recent first.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {devices.map((device) => (
              <DeviceCard key={device.device_id} device={device} />
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto mb-8 w-full max-w-[1280px]">
        <h2 className="mb-1 text-2xl font-bold">Browser extensions</h2>
        <p className="text-muted-foreground mb-6">
          Install it in the browser you actually use. The pages you read are the part of your day no service
          exports.
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
          Install it on the machine you work on. Everything it records stays on your Hub.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          <SourceCard
            logo="/branding/mac/logo.svg"
            name="macOS"
            tracks={CAPTURE_TRACKS}
            onSelect={() => window.open(CAPTURE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
          />
          <SourceCard
            logo="/branding/windows/logo.svg"
            name="Windows"
            tracks={CAPTURE_TRACKS}
            onSelect={() => window.open(CAPTURE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
          />
          <SourceCard
            logo="/branding/linux/logo.svg"
            name="Linux"
            tracks={CAPTURE_TRACKS}
            onSelect={() => window.open(CAPTURE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
          />
        </div>
      </section>
    </div>
  );
}

/** A brand mark for a registered device, chosen from what it told us it is. */
function deviceLogo(device: RegisteredDevice): string | undefined {
  const platform = device.platform?.toLowerCase();

  if (device.device_type === 'browser') {
    const name = device.device_name.toLowerCase();

    if (name.includes('firefox')) {
      return '/branding/firefox/logo.svg';
    }

    if (name.includes('safari')) {
      return '/branding/safari/logo.svg';
    }

    return '/branding/chrome/logo.svg';
  }

  if (platform === 'macos' || platform === 'ios') {
    return '/branding/mac/logo.svg';
  }

  if (platform === 'windows') {
    return '/branding/windows/logo.svg';
  }

  if (platform === 'linux') {
    return '/branding/linux/logo.svg';
  }

  if (platform === 'android') {
    return '/branding/android/logo.svg';
  }

  return undefined;
}

function DeviceCard({ device }: { device: RegisteredDevice }) {
  const tracks: TrackedObject[] =
    device.device_type === 'browser' ? [...BROWSER_TRACKS] : [...CAPTURE_TRACKS];
  const logo = deviceLogo(device);

  return (
    <SourceCard
      logo={logo}
      icon={logo ? undefined : <MonitorSmartphone aria-hidden className="h-full w-full" strokeWidth={1.5} />}
      name={device.device_name}
      tracks={tracks}
      // A registered device is in use by definition — it registered by
      // reporting — so `count` is what turns the card green and says so.
      count={device.is_active ? 1 : 0}
      lastActivityAt={device.last_seen}
      activityVerb="synced"
    />
  );
}
