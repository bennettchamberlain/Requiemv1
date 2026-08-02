import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@apollo/client';
import { LoadingPage, usePageTitle } from '@ci/common';
import { Button, Form, formDataResolver, cn, formDataSchema as s, useForm } from '@ci/shadcn';
import { Navigate } from 'react-router-dom';

import logo from '@/assets/logo.png';
import { useFeatures } from '@/common/feature';
import { GET_CONNECTIONS_LIGHT } from '@/components/connect/ServiceIntegrationsSection';
import { ThemeToggle } from '@/components/ThemePicker';
import { useCurrentUser } from '@/hooks';

import { ActivityPreferences } from './ActivityPreferences';
import { ConnectSourceStep } from './ConnectSourceStep';
import {
  BROWSER_TIMEZONE,
  ONBOARDING_OAUTH_RESUME_KEY,
  buildOnboardingStepKeys,
  type OnboardingStepKey,
} from './constants';
import { FocusAreas } from './FocusAreas';
import { FoodPreferences } from './FoodPreferences';
import { IdentityStep } from './IdentityStep';
import { Intro } from './Intro';
import { MoviePreferences } from './MoviePreferences';
import { OnboardingButton } from './OnboardingButton';
import { RunFirstSyncStep } from './RunFirstSyncStep';
import { SocialConnections } from './SocialConnections';
import { TimeAndPlaceStep } from './TimeAndPlaceStep';
import { TrustDialStep } from './TrustDialStep';
import { useOnboardingProgress } from './useOnboardingProgress';

export const OnboardingFormSchema = s.object({
  name: s.string().nullable().optional(),
  timezone: s.string().nullable().optional(),
  schedule: s
    .object({
      wake_time: s.string(),
      sleep_time: s.string(),
      work_start: s.string(),
      work_end: s.string(),
    })
    .nullable()
    .optional(),
  trust_mode: s.enum(['cautious', 'balanced', 'hands_off']).nullable().optional(),
  focus_areas: s.array(s.string()).nullable().default(null),
  people: s
    .array(
      s.object({
        first: s.string(),
        last: s.string(),
        relationship: s.string(),
      }),
    )
    .nullable()
    .default(null),
  food_preference: s.enum(['Pasta', 'Burgers', 'Salad', 'Tacos']).nullable().default(null),
  movie_preference: s.enum(['Dramas', 'Documentaries', 'Comedies', 'Horror']).nullable().default(null),
  activity_preference: s.enum(['Hiking', 'Bowling', 'Skating', 'Arcading']).nullable().default(null),
});

export type OnboardingFormData = s.input<typeof OnboardingFormSchema>;

const DEFAULT_FORM_VALUES: OnboardingFormData = {
  name: null,
  timezone: BROWSER_TIMEZONE,
  schedule: {
    wake_time: '07:00',
    sleep_time: '21:00',
    work_start: '09:00',
    work_end: '18:00',
  },
  trust_mode: 'balanced',
  focus_areas: null,
  people: null,
  food_preference: null,
  movie_preference: null,
  activity_preference: null,
};

export function OnboardingPage() {
  usePageTitle('Onboarding - Companion Intelligence');

  const { user, loading: userLoading } = useCurrentUser();
  const { isFeatureEnabled } = useFeatures();
  const { fetchProgress, saveProgress, loading: progressLoading } = useOnboardingProgress();
  const { data: connectionsData } = useQuery(GET_CONNECTIONS_LIGHT, { fetchPolicy: 'cache-and-network' });

  const preferenceStepsEnabled = isFeatureEnabled('onboarding.preference.steps');
  const needsIdentity = user?.needsIdentityStep ?? user?.name === user?.email;

  const stepKeys = useMemo(
    () => buildOnboardingStepKeys({ needsIdentity: !!needsIdentity, preferenceStepsEnabled }),
    [needsIdentity, preferenceStepsEnabled],
  );

  const form = useForm<OnboardingFormData>({
    resolver: formDataResolver(OnboardingFormSchema),
    shouldUnregister: false,
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [resumeUpdatedAt, setResumeUpdatedAt] = useState<string | null>(null);

  const currentStepKey = stepKeys[stepIndex] ?? 'intro';

  const hasConnections =
    (connectionsData?.connections.edges.filter(
      (e: { node: { active: boolean } }) => e.node.active,
    ).length ?? 0) > 0;

  useEffect(() => {
    if (userLoading || hydrated) {
      return;
    }

    void (async () => {
      const progress = await fetchProgress();
      const draft = { ...DEFAULT_FORM_VALUES, ...(progress?.draft ?? {}) } as OnboardingFormData;
      form.reset(draft);

      if (progress?.updatedAt) {
        setResumeUpdatedAt(progress.updatedAt);
      }

      const oauthResume = localStorage.getItem(ONBOARDING_OAUTH_RESUME_KEY);
      const targetKey =
        oauthResume != null
          ? ('connect-source' as OnboardingStepKey)
          : ((progress?.stepKey as OnboardingStepKey | undefined) ?? 'intro');

      if (oauthResume != null) {
        localStorage.removeItem(ONBOARDING_OAUTH_RESUME_KEY);
      }

      const idx = stepKeys.indexOf(targetKey);
      setStepIndex(idx >= 0 ? idx : 0);
      setHydrated(true);
    })();
  }, [userLoading, hydrated, fetchProgress, form, stepKeys]);

  const persistProgress = useCallback(
    async (nextIndex: number, draftOverride?: OnboardingFormData) => {
      const key = stepKeys[nextIndex] ?? 'intro';
      const draft = draftOverride ?? form.getValues();

      if (currentStepKey === 'time-and-place' && !draft.timezone) {
        draft.timezone = BROWSER_TIMEZONE;
      }

      await saveProgress(key, draft as Record<string, unknown>);
    },
    [currentStepKey, form, saveProgress, stepKeys],
  );

  const scrollToTop = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    });
  }, []);

  const goToStep = useCallback(
    async (nextIndex: number) => {
      await persistProgress(nextIndex);
      setStepIndex(nextIndex);
      scrollToTop();
    },
    [persistProgress, scrollToTop],
  );

  const handleNext = useCallback(() => {
    if (currentStepKey === 'time-and-place') {
      form.setValue('timezone', BROWSER_TIMEZONE);
    }

    void goToStep(Math.min(stepIndex + 1, stepKeys.length - 1));
  }, [currentStepKey, form, goToStep, stepIndex, stepKeys.length]);

  const handleBack = useCallback(() => {
    void goToStep(Math.max(stepIndex - 1, 0));
  }, [goToStep, stepIndex]);

  const handleSkip = useCallback(() => {
    void handleNext();
  }, [handleNext]);

  const goToConnect = useCallback(() => {
    const idx = stepKeys.indexOf('connect-source');
    if (idx >= 0) {
      void goToStep(idx);
    }
  }, [goToStep, stepKeys]);

  const setTrustMode = useCallback(
    (value: NonNullable<OnboardingFormData['trust_mode']>) => {
      form.setValue('trust_mode', value);
    },
    [form],
  );

  const stepContent = useMemo(() => {
    switch (currentStepKey) {
      case 'intro':
        return <Intro />;
      case 'identity':
        return <IdentityStep />;
      case 'time-and-place':
        return <TimeAndPlaceStep />;
      case 'focus-areas':
        return <FocusAreas />;
      case 'people':
        return <SocialConnections />;
      case 'preferences-food':
        return <FoodPreferences />;
      case 'preferences-movie':
        return <MoviePreferences />;
      case 'preferences-activity':
        return <ActivityPreferences />;
      case 'connect-source':
        return <ConnectSourceStep />;
      case 'trust-dial':
        return <TrustDialStep value={form.watch('trust_mode')} onChange={setTrustMode} />;
      case 'run-first-sync':
        return (
          <RunFirstSyncStep
            hasConnections={hasConnections}
            onBack={handleBack}
            onGoToConnect={goToConnect}
          />
        );
      default:
        return <Intro />;
    }
  }, [currentStepKey, form, goToConnect, handleBack, hasConnections, setTrustMode]);

  const contentMaxWidth =
    currentStepKey === 'connect-source' ? 'max-w-5xl' : 'max-w-lg';

  if (user?.onboarded) {
    return <Navigate to="/feed" replace />;
  }

  if (userLoading || progressLoading || !hydrated) {
    return <LoadingPage message="Loading your setup…" />;
  }

  const isFinalStep = currentStepKey === 'run-first-sync';
  const showNav = !isFinalStep;

  return (
    <Form {...form}>
      <form className="relative h-lvh flex flex-col">
        <div className="absolute top-0 left-0 h-[max(0.5rem,env(safe-area-inset-top))] w-full">
          <div className="absolute top-full right-2 z-10 text-foreground">
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-col items-center flex-1 w-full gap-4 h-full">
          <div className="self-start px-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <img src={logo} className="w-8 h-8" alt="" />
          </div>

          <div
            ref={scrollRef}
            className={cn(
              'flex-1 overflow-y-auto min-h-0 w-full mx-auto px-4 md:px-6',
              contentMaxWidth,
            )}
          >
            {resumeUpdatedAt && (
              <div className="mb-4 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-xs text-foreground text-center">
                Welcome back — you&apos;re on step {stepIndex + 1} of {stepKeys.length}. Everything
                you&apos;ve entered is saved.
              </div>
            )}

            <div className="flex flex-col justify-center items-center text-center min-h-full w-full">
              {stepContent}
            </div>
          </div>

          {showNav && (
            <div className="flex items-center gap-3 px-4">
              {stepIndex > 0 && (
                <Button type="button" variant="ghost" onClick={handleBack}>
                  Back
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={handleSkip}>
                Skip
              </Button>
              <OnboardingButton type="button" className="px-12" onClick={handleNext}>
                Next
              </OnboardingButton>
            </div>
          )}

          <div className="flex flex-col items-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex justify-center items-center">
              {stepKeys.map((key, i) => (
                <div
                  key={key}
                  className={cn(
                    'h-2 w-2 m-2 rounded-full transition-all duration-500',
                    i === stepIndex ? 'bg-slate-800 scale-115' : 'bg-slate-300',
                  )}
                />
              ))}
            </div>
            {stepIndex === 0 && (
              <p className="text-[11px] text-muted-foreground text-center -mt-1">
                Step {stepIndex + 1} of {stepKeys.length} — every step is skippable
              </p>
            )}
          </div>
        </div>
      </form>
    </Form>
  );
}
