import { Outlet } from 'react-router-dom';

import { ThemeToggle } from '@/components/ThemePicker';

export function Centered() {
  return (
    <div className="safe-area-inset relative flex min-h-dvh w-full flex-col items-stretch justify-start overflow-y-auto p-6 sm:items-center sm:justify-center md:p-10">
      <div className="absolute top-0 left-0 h-[max(0.5rem,var(--safe-area-top))] w-full">
        <div className="absolute top-full right-2 z-10">
          <ThemeToggle />
        </div>
      </div>
      <Outlet />
    </div>
  );
}
