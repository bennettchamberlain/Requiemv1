import { Portal } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { Download } from '@ci/shadcn/icons';
import { Link, useNavigate } from 'react-router-dom';

import { ServiceIntegrationsSection } from '@/components/connect/ServiceIntegrationsSection';
import { PageContent } from '@/components/layout';

import { Card } from './Card';

// const DOWNLOAD_URL = 'https://ci.computer/download';
const CAPTURE_DOWNLOAD_URL = 'https://ci.computer/download#capture';

export function ConnectPage() {
  const navigate = useNavigate();
  // const openDownload = () => window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  const openCaptureDownload = () => window.open(CAPTURE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/feed">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Connect</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        {/* Browser Extensions Section */}
        <div className="max-w-[1040px] mx-auto mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Browser Extensions</h2>
          <p className="text-muted-foreground mb-6">
            Install our browser extensions to automatically capture your web activity and browsing patterns.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
            <Card
              logo="/branding/chrome/logo.svg"
              background="bg-blue-500"
              border="border-blue-400"
              text="Install the Chrome extension to automatically track your browsing history, bookmarks, and web activity."
              onClick={() => {
                window.open(
                  'https://chromewebstore.google.com/detail/companion-intelligence/bcocflgkdeimninckpmdifcniajoneih?authuser=3&hl=en',
                  '_blank',
                );
              }}
            />
            <Card
              logo="/branding/firefox/logo.svg"
              background="bg-orange-500"
              border="border-orange-400"
              text="Get the Firefox extension to capture your web browsing patterns and site interactions."
              disabled
            />
            <Card
              logo="/branding/safari/logo.svg"
              background="bg-blue-600"
              border="border-blue-500"
              text="Install the Safari extension for seamless web activity tracking on macOS and iOS."
              disabled
            />
          </div>
        </div>

        {/* Companion Capture */}
        <div className="max-w-[1040px] mx-auto mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Companion Capture</h2>
          <p className="text-muted-foreground mb-6">
            Install Companion Capture to record desktop activity, screen context, and local usage on your
            machine — everything stays on your Hub.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
            <Card
              logo="/branding/mac/logo.svg"
              background="bg-gray-600"
              border="border-gray-500"
              text="Download Companion Capture for macOS (Apple Silicon and Intel)."
              onClick={openCaptureDownload}
            />
            <Card
              logo="/branding/windows/logo.svg"
              background="bg-blue-600"
              border="border-blue-500"
              text="Download Companion Capture for Windows."
              onClick={openCaptureDownload}
            />
            <Card
              logo="/branding/linux/logo.svg"
              background="bg-yellow-600"
              border="border-yellow-500"
              text="Download Companion Capture for Linux (deb and AppImage)."
              onClick={openCaptureDownload}
            />
          </div>
        </div>

        {/* Devices Section — hidden until device connect flows are ready (was linking to ci.computer/download). */}
        {/*
        <div className="max-w-[1040px] mx-auto mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Devices</h2>
          <p className="text-muted-foreground mb-6">
            Connect your smart devices and hardware to track usage patterns and environmental data.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
            <Card
              logo="/branding/home-assistant/logo.svg"
              background="bg-blue-500"
              border="border-blue-400"
              text="Connect Home Assistant to track your smart home interactions, automation usage, and device states."
              onClick={openDownload}
              disabled
            />
            <Card
              logo="/branding/quest/logo.svg"
              background="bg-gray-800"
              border="border-gray-700"
              text="Link your Quest VR headset to use your camera for XR tracking and more to unlock embodied agentic immersive experiences."
              onClick={openDownload}
              disabled
            />
            <Card
              logo="/branding/ios/logo.svg"
              background="bg-blue-500"
              border="border-blue-400"
              text="Download the iOS app to track your mobile usage, screen time, and app interactions on iPhone and iPad."
              onClick={openDownload}
              disabled
            />
            <Card
              logo="/branding/android/logo.svg"
              background="bg-green-500"
              border="border-green-400"
              text="Install the Android app to monitor your device usage, notifications, and mobile activity patterns."
              onClick={openDownload}
              disabled
            />
            <Card
              logo="/branding/windows/logo.svg"
              background="bg-blue-600"
              border="border-blue-500"
              text="Get the Windows app to track your desktop activity, application usage, and system interactions."
              onClick={openDownload}
              disabled
            />
            <Card
              logo="/branding/mac/logo.svg"
              background="bg-gray-600"
              border="border-gray-500"
              text="Download the macOS app to monitor your Mac usage, workspace activity, and application patterns."
              onClick={openDownload}
              disabled
            />
            <Card
              logo="/branding/linux/logo.svg"
              background="bg-yellow-600"
              border="border-yellow-500"
              text="Install the Linux app to track your system usage, command line activity, and development workflows."
              onClick={openDownload}
              disabled
            />
          </div>
        </div>
        */}
        {/* Import Tools */}
        <div className="max-w-[1040px] mx-auto mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Import Tools</h2>
          <p className="text-muted-foreground mb-6">
            Import data archives from a wide range of services
          </p>
          {/* The same grid as every other section, so the lone card keeps the
              shared card size instead of stretching across the row. */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
            <Card
              icon={<Download aria-hidden className="h-12 w-12 text-blue-600" />}
              background="bg-blue-600"
              border="border-blue-500"
              text="Import data archives you've exported from your services — Google Takeout, Apple, Spotify, and dozens more."
              onClick={() => navigate('/import')}
            />
          </div>
        </div>

        {/* Service Integrations Section */}
        <div className="max-w-[1040px] mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Service Integrations</h2>
          <p className="text-muted-foreground mb-6">
            Connect your favorite services to automatically sync your data and activities.
          </p>
          <ServiceIntegrationsSection variant="page" />
        </div>
      </PageContent>
    </>
  );
}
