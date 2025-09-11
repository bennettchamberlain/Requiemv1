import { Suspense } from 'react';

import { LoadingPage, Portal, useDeviceLayout } from '@ci/common';
import { Sidebar, Toaster } from '@ci/shadcn';
import { Outlet } from 'react-router-dom';

import { MobileNavigation } from './MobileNavigation/MobileNavigation';
import { PrimaryNavigation } from './PrimaryNavigation';
import { SecondaryNavigation } from './SecondaryNavigation';

export function Main() {
  const { isMobile } = useDeviceLayout();

  if (isMobile) {
    return (
      <div className="flex flex-col h-lvh">
        <main className="flex-1 min-w-0 overflow-hidden min-h-0">
          <Suspense fallback={<LoadingPage />}>
            <Outlet />
          </Suspense>
        </main>
        <MobileNavigation />
      </div>
    );
  }

  return (
    <>
      <Sidebar.Provider>
        <SecondaryNavigation />

        <Sidebar.Inset className="overflow-hidden">
          <Suspense fallback={<LoadingPage />}>
            <Toaster />

            <div className="flex flex-col h-lvh">
              <PrimaryNavigation />

              <div className="flex flex-row flex-1 min-h-0">
                <Portal id="tertiary-navigation" className="h-full" />

                <main className="flex-1 min-w-0">
                  <Outlet />
                </main>
              </div>
            </div>
          </Suspense>
        </Sidebar.Inset>
      </Sidebar.Provider>
    </>
  );
}
