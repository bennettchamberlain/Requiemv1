import { Suspense } from 'react';

import { LoadingPage, Portal, useDeviceLayout } from '@ci/common';
import { Toaster } from '@ci/shadcn';
import { Outlet } from 'react-router-dom';

import { ConnectionModeIndicator, OutboxQueueIndicator } from '@/components/ConnectionModeIndicator';
import { useTheme } from '@/components/ThemePicker';
import { useUnsyncedImportsNotice } from '@/components/UnsyncedImports/useUnsyncedImportsNotice';

import { MobileNavigation } from './MobileNavigation/MobileNavigation';
import { PowerRailProvider } from './PowerRailContext';
import { PowerRailToggle } from './PowerRailToggle';
import { PrimaryNavigation } from './PrimaryNavigation';
import { SecondaryNavigation } from './SecondaryNavigation';

export function Main() {
  const { isMobile } = useDeviceLayout();
  const { themeState } = useTheme();

  // Every authenticated page passes through this layout, which makes it the
  // one place a page-load check reaches "across all pages".
  useUnsyncedImportsNotice();

  if (isMobile) {
    return (
      <div className="flex flex-col h-lvh">
        <Toaster position="top-right" theme={themeState.mode} />
        <div className="fixed top-2 right-2 z-40 flex items-center gap-1.5">
          <ConnectionModeIndicator />
          <OutboxQueueIndicator />
        </div>
        <main className="flex-1 min-w-0 overflow-hidden min-h-0 relative">
          <Suspense fallback={<LoadingPage />}>
            <Outlet />
            <Portal id="content-modal" className="absolute inset-0 empty:hidden" />
          </Suspense>
        </main>
        <MobileNavigation />
        <Portal id="overlay-modal" className="fixed inset-0 z-50 empty:hidden" />
      </div>
    );
  }

  return (
    <PowerRailProvider>
      <div className="grid h-lvh min-h-0 grid-cols-[auto_1fr] grid-rows-[auto_1fr]">
        {/* Left-aligned so the mark stays put when the rail widens. Centering
            it here walks the logo to the middle of the expanded column. */}
        {/* No padding here: the toggle carries the drawer's own width and
            inset, so the two line up as one edge. */}
        {/* Stretch with the header row, then center the mark so leftover
            space is equal above and below — otherwise the toggle sits at the
            top of a taller PrimaryNavigation cell and looks bottom-heavy. */}
        <div className="flex items-center bg-secondary">
          <PowerRailToggle />
        </div>

        <div className="bg-secondary/20 border-b border-b-secondary/90">
          <PrimaryNavigation />
        </div>

        {/* No background or border here: the rail is a drawer that floats over
            the content when hovered, so it owns its own surface. Painting the
            lane too would double the tint wherever the two overlap. */}
        <SecondaryNavigation />

        <div className="overflow-hidden min-w-0 min-h-0 flex flex-col">
          <Suspense fallback={<LoadingPage />}>
            <Toaster theme={themeState.mode} />
            <div className="flex flex-row h-full min-h-0">
              <Portal id="tertiary-navigation" className="h-full" />
              <main className="flex-1 min-w-0 relative">
                <Outlet />
                <Portal id="content-modal" className="absolute inset-0 empty:hidden" />
              </main>
            </div>
          </Suspense>
        </div>
        <Portal id="overlay-modal" className="fixed inset-0 z-50 empty:hidden" />
      </div>
    </PowerRailProvider>
  );
}
