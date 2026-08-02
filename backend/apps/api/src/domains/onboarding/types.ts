import { z } from 'zod';

export const ONBOARDING_STEP_KEYS = [
  'intro',
  'identity',
  'time-and-place',
  'focus-areas',
  'people',
  'preferences-food',
  'preferences-movie',
  'preferences-activity',
  'connect-source',
  'trust-dial',
  'run-first-sync',
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export const TrustModeSchema = z.enum(['cautious', 'balanced', 'hands_off']);

export const ScheduleSchema = z.object({
  wake_time: z.string(),
  sleep_time: z.string(),
  work_start: z.string(),
  work_end: z.string(),
});

export const OnboardingInputSchema = z.object({
  name: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  schedule: ScheduleSchema.nullable().optional(),
  trust_mode: TrustModeSchema.nullable().optional(),
  focus_areas: z.array(z.string()).nullable().default(null),
  people: z
    .array(
      z.object({
        first: z.string(),
        last: z.string(),
        relationship: z.string(),
      }),
    )
    .nullable()
    .default(null),
  food_preference: z.enum(['Pasta', 'Burgers', 'Salad', 'Tacos']).nullable().default(null),
  movie_preference: z.enum(['Dramas', 'Documentaries', 'Comedies', 'Horror']).nullable().default(null),
  activity_preference: z.enum(['Hiking', 'Bowling', 'Skating', 'Arcading']).nullable().default(null),
});

export type OnboardingInput = z.infer<typeof OnboardingInputSchema>;

export const OnboardingProgressInputSchema = z.object({
  stepKey: z.enum(ONBOARDING_STEP_KEYS),
  draft: z.record(z.unknown()).default({}),
});

export type OnboardingProgressInput = z.infer<typeof OnboardingProgressInputSchema>;

export interface OnboardingProgressResponse {
  stepKey: OnboardingStepKey;
  draft: Record<string, unknown>;
  updatedAt: string | null;
}
