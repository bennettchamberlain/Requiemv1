import { useState } from 'react';

import { usePageTitle } from '@ci/common';
import { Button, cn } from '@ci/shadcn';

import logo from '@/assets/logo.png';
import { ThemeToggle } from '@/components/ThemeToggle';

import { ActivityPreferences } from './ActivityPreferences';
import focusAreasImage from './assets/focus-areas.jpg';
import peopleImage from './assets/people.jpg';
import { FocusAreas } from './FocusAreas';
import { FoodPreferences } from './FoodPreferences';
import { Intro } from './Intro';
import { MoviePreferences } from './MoviePreferences';
import { SocialConnections } from './SocialConnections';

export function OnboardingPage() {
  usePageTitle('Onboarding - Companion Intelligence');

  const [step, setStep] = useState(0);

  const steps = [
    <Intro />,
    <FocusAreas />,
    <SocialConnections />,
    <FoodPreferences />,
    <MoviePreferences />,
    <ActivityPreferences />,
  ];

  const images = [
    null,
    <div
      className="flex-1 bg-cover bg-center hidden md:block"
      style={{
        backgroundImage: `url(${focusAreasImage})`,
      }}
    />,
    <div
      className="flex-1 bg-cover bg-center hidden md:block"
      style={{
        backgroundImage: `url(${peopleImage})`,
      }}
    />,
    null,
    null,
    null,
  ];

  return (
    <div className="relative h-lvh flex md:flex-row flex-col">
      <div className="absolute top-0 left-0 h-[max(0.5rem,env(safe-area-inset-top))] w-full">
        <div className="absolute top-full right-2 z-10 text-white md:text-foreground">
          <ThemeToggle />
        </div>
      </div>

      <div className="flex flex-col items-center flex-1/4 gap-4">
        <div className="self-start p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <img src={logo} className="w-8 h-8" />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 md:max-w-xl mx-4 md:mx-8">
          {steps[step % steps.length]}
        </div>

        <Button className="px-24" onClick={() => setStep((current) => current + 1)}>
          Next
        </Button>

        <div className="flex justify-center items-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {Array.from({ length: steps.length }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-2 w-2 m-2 rounded-full transition-all duration-500',
                i === step % steps.length ? 'bg-slate-800 scale-115' : 'bg-slate-300',
              )}
            />
          ))}
        </div>
      </div>

      {images[step % steps.length]}
    </div>
  );
}
