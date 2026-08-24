/**
 * "Life details" on Self — a fixed, hand-curated slice of the Reflections
 * catalogue (not new Person schema), picked question-by-question rather than
 * "whatever a category filter returns first": a generic category fetch
 * surfaced low-value trivia ("Are you colorblind?", "Are you registered as an
 * organ donor?") ahead of anything worth having on a profile.
 *
 * `text`/`category`/`questionType`/`tier` are baked in here rather than
 * re-fetched — the only thing that can change server-side for a fixed id is
 * whether it's been answered, so the one network call this module builds
 * asks for exactly that (see `curatedCatalogueUrl`). Trade-off, stated
 * plainly: if a question's phrasing is edited server-side, this list shows
 * the old wording until someone updates it here — acceptable for a fixed,
 * hand-picked list that isn't expected to drift, same as any other
 * hard-coded UI copy.
 *
 * Kept apart from the component so the curated list and query-building stay
 * unit-testable without a renderer.
 */
import type { CatalogueAnswer } from '@/pages/PromptsPage/catalogue';

export type LifeDetailQuestionType = 'open_ended' | 'yes_no' | 'multiple_choice';
export type LifeDetailAnswerTier = 'factual' | 'preference' | 'narrative';

export interface CuratedQuestion {
  id: string;
  text: string;
  /** `ci.questions.question_category` — provenance only, not used to fetch. */
  category: string;
  questionType: LifeDetailQuestionType;
  tier: LifeDetailAnswerTier;
  /**
   * Button labels, posted verbatim as the answer text when clicked. Present
   * for every `yes_no` question and for the `multiple_choice` ones whose
   * options are unambiguous, low-stakes lifestyle picks (season, cat/dog,
   * beach/mountains…). Deliberately absent for the two identity-flavored
   * `multiple_choice` questions (pronouns, relationship status): the
   * catalogue itself defines no real option list for `multiple_choice`
   * (there is no schema for it), so any button set here would be this UI's
   * own invention — fine for "beach or mountains", not something to impose
   * on how someone describes their pronouns or relationship. Those two stay
   * free text.
   */
  options?: string[];
}

export interface LifeDetailTheme {
  key: string;
  label: string;
  questions: CuratedQuestion[];
}

export const LIFE_DETAIL_THEMES: LifeDetailTheme[] = [
  {
    key: 'health',
    label: 'Health',
    questions: [
      {
        id: 'e87d2be3-28f3-4916-ab12-fda1931c2479',
        text: 'What is your blood type?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: '19643a63-47e5-4963-8222-c734fba9d6d8',
        text: 'What foods are you allergic to?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'de991610-d97b-48ee-9e71-e717afac8b7a',
        text: 'Are you allergic to any medications?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'b61394b3-69d6-45d6-bf92-5418789839f0',
        text: 'What chronic conditions have you been diagnosed with?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'c133b0cf-097b-440d-82d8-737115cca9db',
        text: 'What medications do you take regularly?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'e87ffe6e-bd18-4297-8da3-6d7c9c187759',
        text: 'Which health conditions run in your immediate family?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
    ],
  },
  {
    key: 'body',
    label: 'Body',
    questions: [
      {
        id: '1aa9360b-dcdc-4616-b7d7-22f7770619eb',
        text: 'How tall are you?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: '1656186e-c210-42a0-bd7b-9407c408a125',
        text: 'What is your current weight?',
        category: 'Health & Body',
        questionType: 'open_ended',
        tier: 'factual',
      },
    ],
  },
  {
    key: 'identity',
    label: 'Identity & Background',
    // Ordered low-stakes/factual first, most personal last — pronouns before
    // orientation, not the reverse.
    questions: [
      {
        id: '4a1e9f9c-6aed-426d-9f3b-76b2cd22154f',
        text: 'What pronouns do you use?',
        category: 'Identity & Background',
        questionType: 'multiple_choice',
        tier: 'factual',
      },
      {
        id: 'bacfc834-bf94-4d64-8808-2f3dd0bd861e',
        text: 'What languages do you speak?',
        category: 'Identity & Background',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'cc0cb904-0de6-42c5-b10e-02600c35d87f',
        text: 'What cultural or ethnic background does your family identify with?',
        category: 'Identity & Background',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'e71b34e7-ea4d-49bb-89f3-f526a86c2519',
        text: 'What is your religion or spiritual practice now, if any?',
        category: 'Identity & Background',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: '814650fc-d5b7-4d21-8a0b-1882726458c4',
        text: 'What is your relationship status?',
        category: 'Identity & Background',
        questionType: 'multiple_choice',
        tier: 'factual',
      },
      {
        id: '5a498ece-079d-4da6-a28b-f9182f0495e1',
        text: 'How would you describe your sexual orientation?',
        category: 'Identity & Background',
        questionType: 'open_ended',
        tier: 'preference',
      },
    ],
  },
  {
    key: 'lifePreferences',
    label: 'Preferences',
    questions: [
      {
        id: 'bf834f6c-0b59-4fab-8960-503e1b94694a',
        text: 'Are you a morning person or a night owl?',
        category: 'Preferences & Favorites',
        questionType: 'multiple_choice',
        tier: 'preference',
        options: ['Morning person', 'Night owl'],
      },
      {
        id: 'e4ec3776-fb7d-498f-b48f-d26f0df269f0',
        text: 'What is your favorite season?',
        category: 'Preferences & Favorites',
        questionType: 'multiple_choice',
        tier: 'preference',
        options: ['Spring', 'Summer', 'Fall', 'Winter'],
      },
      {
        id: '4136554c-6be1-4c21-8dd4-ea462cd76117',
        text: 'Are you more of a cat person or a dog person?',
        category: 'Preferences & Favorites',
        questionType: 'multiple_choice',
        tier: 'preference',
        options: ['Cat person', 'Dog person'],
      },
      {
        id: '8ad777b3-580a-4850-90d0-5b553ba3d1d4',
        text: 'Do you prefer the beach or the mountains?',
        category: 'Preferences & Favorites',
        questionType: 'multiple_choice',
        tier: 'preference',
        options: ['Beach', 'Mountains'],
      },
      {
        id: 'a57a5f8a-4f28-401b-b798-1b39bc897cab',
        text: 'Do you prefer to cook or to order in?',
        category: 'Preferences & Favorites',
        questionType: 'multiple_choice',
        tier: 'preference',
        options: ['Cook', 'Order in'],
      },
      {
        id: '1e00a3c2-e071-4360-8a9a-e020baeace00',
        text: 'What is your favorite cuisine?',
        category: 'Preferences & Favorites',
        questionType: 'open_ended',
        tier: 'preference',
      },
      {
        id: '94ffe494-a094-4d6d-bc3c-69672d3373b0',
        text: 'What food will you not eat under any circumstances?',
        category: 'Preferences & Favorites',
        questionType: 'open_ended',
        tier: 'factual',
      },
    ],
  },
  {
    key: 'interests',
    label: 'Interests & Culture',
    // Just one narrative "tell me about your hobby" prompt, not two asking
    // the same thing from slightly different angles.
    questions: [
      {
        id: '8ac610c9-27aa-4505-b79f-bc89c4f50dca',
        text: 'Which hobby have you kept the longest, and for how many years?',
        category: 'Interests & Culture',
        questionType: 'open_ended',
        tier: 'narrative',
      },
      {
        id: 'a8b97245-cac2-4771-949f-6a4bb1ea2f28',
        text: 'What skill are you trying to get better at this year?',
        category: 'Interests & Culture',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'e9afce2b-acb7-4a73-a1c0-3394add95b52',
        text: 'Do you volunteer for any organization?',
        category: 'Interests & Culture',
        questionType: 'yes_no',
        tier: 'factual',
        options: ['Yes', 'No'],
      },
      {
        id: '6ea30fa3-b3d5-4bee-b920-87863627f4b1',
        text: 'Which languages are you learning, if any?',
        category: 'Interests & Culture',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'a11f73d3-a7cb-4170-890e-4ec44d295f0f',
        text: 'What sports do you follow?',
        category: 'Interests & Culture',
        questionType: 'open_ended',
        tier: 'factual',
      },
    ],
  },
  {
    key: 'homeTown',
    label: 'Home Town',
    // Birth city and childhood city are distinct facts (many people move as
    // kids); one narrative prompt anchors the rest rather than three that all
    // fish at "tell me about growing up" from slightly different angles.
    questions: [
      {
        id: '8565f9fa-965a-49c4-81fb-6ab8b3a4ee70',
        text: 'What city were you born in?',
        category: 'Places & Travel',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: 'd5e6e582-c0e3-40c5-aa2c-5e100c7c384d',
        text: 'In which city did you spend most of your childhood?',
        category: 'Places & Travel',
        questionType: 'open_ended',
        tier: 'factual',
      },
      {
        id: '99c65199-4185-4e38-ae96-69e542b2531f',
        text: 'What do you remember most about the home you grew up in?',
        category: 'Home & Daily Life',
        questionType: 'open_ended',
        tier: 'narrative',
      },
    ],
  },
];

/** Every curated id across every theme, in a fixed flat order. */
export function curatedQuestionIds(): string[] {
  return LIFE_DETAIL_THEMES.flatMap((theme) => theme.questions.map((q) => q.id));
}

/**
 * One combined fetch for the whole section: every curated id's current
 * answer, in a single round trip. `limit` is set to the id count explicitly —
 * the endpoint's default (25) would silently truncate this set.
 */
export function curatedCatalogueUrl(): string {
  const ids = curatedQuestionIds();
  const params = new URLSearchParams({
    ids: ids.join(','),
    status: 'active',
    answered: 'all',
    limit: String(ids.length),
  });

  return `/api/questions/catalogue?${params.toString()}`;
}

export type CuratedAnswers = Record<string, CatalogueAnswer | null>;
