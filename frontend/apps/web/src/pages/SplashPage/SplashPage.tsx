import { useMemo } from 'react';

import { useDeviceLayout } from '@ci/common';
import { Button } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import balloonImage from '@/assets/balloon-bouquet.jpg';
import { ThemeToggle } from '@/components/ThemeToggle';

export function SplashPage() {
  const { isMobile } = useDeviceLayout();

  const gradient = useMemo(
    () =>
      isMobile
        ? 'linear-gradient(to bottom, rgba(0,0,0,0.8), rgba(0,0,0,0))'
        : 'linear-gradient(to right, rgba(0,0,0,0.6), rgba(0,0,0,0))',
    [isMobile],
  );

  return (
    <div className="relative h-lvh flex md:flex-row flex-col">
      <div className="absolute top-0 left-0 h-[max(0.5rem,env(safe-area-inset-top))] w-full">
        <div className="absolute top-full right-2 z-10 text-white md:text-foreground">
          <ThemeToggle />
        </div>
      </div>

      <div
        className="flex flex-col items-center justify-center flex-1 p-8 bg-cover bg-center text-white pt-[max(2rem,env(safe-area-inset-top))]"
        style={{
          backgroundImage: `${gradient}, url(${balloonImage})`,
        }}
      >
        <div className="md:max-w-xs text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Companion Intelligence</h1>
          <p className="text-lg md:text-xl">
            Your personal AI assistant helping you navigate daily tasks with ease.
          </p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center flex-1/4 p-8 gap-8">
        <div className="flex-1 hidden md:block"></div>
        <div className="md:max-w-xl text-center md:text-left">
          <h2 className="text-3xl md:text-4xl font-bold mb-3">Your personal assistant</h2>
          <p className="text-lg">
            Companion Intelligence is a personal AI that helps you manage your schedule, remember important
            details, and simplify your daily life. Think of it as your personal assistant, always ready to
            help.
          </p>
        </div>
        <div className="flex-1">
          <Button variant="outline" asChild size="lg" className="px-8">
            <Link to="/login">Log In</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
