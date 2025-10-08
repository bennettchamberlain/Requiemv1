import { z } from 'zod';

export const OnboardingInputSchema = z.object({
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
