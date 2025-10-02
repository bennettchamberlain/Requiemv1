import { useState } from 'react';

import { usePageTitle } from '@ci/common';
import { Button, cn } from '@ci/shadcn';

import logo from '@/assets/logo.png';
import { ThemeToggle } from '@/components/ThemeToggle';

import focusAreasImage from './focus-areas.png';
import { FocusAreas } from './FocusAreas';
import peopleImage from './people.png';
import { SocialConnections } from './SocialConnections';

export function OnboardingPage() {
  usePageTitle('Onboarding - Companion Intelligence');

  const [step, setStep] = useState(0);

  const steps = [<FocusAreas />, <SocialConnections />];

  const images = [
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
  ];

  return (
    <div className="relative h-lvh flex md:flex-row flex-col">
      <div className="absolute top-0 left-0 h-[max(0.5rem,env(safe-area-inset-top))] w-full">
        <div className="absolute top-full right-2 z-10 text-white md:text-foreground">
          <ThemeToggle />
        </div>
      </div>

      <div className="flex flex-col items-center justify-between flex-1/4 gap-4">
        <div className="flex self-start flex-1 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <img src={logo} className="w-8 h-8" />
        </div>

        <div className="space-y-12 md:max-w-xl mx-4 md:mx-8">
          <div>{steps[step % steps.length]}</div>

          <div className="text-center">
            <Button className="w-64" onClick={() => setStep((current) => current + 1)}>
              Next
            </Button>
          </div>
        </div>

        <div className="flex items-end justify-center flex-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-center">
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
      </div>

      {images[step % steps.length]}
    </div>
  );
}
