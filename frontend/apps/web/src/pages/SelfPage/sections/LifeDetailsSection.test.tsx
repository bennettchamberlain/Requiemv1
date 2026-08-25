import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { curatedQuestionKeys, curatedQuestions, type CuratedQuestion } from './lifeDetails';
import { LifeDetailsSection } from './LifeDetailsSection';

const h = vi.hoisted(() => ({ authToken: 'jwt-abc' as string | null }));

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: h.authToken }, {}],
}));

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@ci/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ci/common')>()),
  fetchJson,
}));

interface FetchCallInit {
  method?: string;
  body?: string;
}

// Curated keys, not ids: `question_id` is minted per appliance, so a test that
// hardcoded one would be asserting the very coupling this list exists to avoid.
// A yes_no question, a narrative open_ended one, and a compact open_ended one,
// so each control type is exercised against the real curated list.
const VOLUNTEER_KEY = 'volunteering';
const HOBBY_KEY = 'longest_hobby';
const BLOOD_TYPE_KEY = 'blood_type';

/**
 * The uuid the catalogue reports for a curated key on THIS database. Derived
 * from the key so the test never has to invent an id/key pairing by hand, and
 * deliberately unlike anything in lifeDetails.ts — an assertion that passes
 * only because the component read the id off the response.
 */
function serverIdFor(key: string): string {
  const index = curatedQuestionKeys().indexOf(key);

  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function catalogueEntry(question: CuratedQuestion, answerText: string | null = null) {
  const id = serverIdFor(question.key);

  return {
    id,
    key: question.key,
    text: question.text,
    category: question.category,
    answerTier: question.tier,
    questionType: question.questionType,
    frequencyRecommendation: 'annually',
    isActive: true,
    isSeedQuestion: true,
    createdByLlm: false,
    isPrivateTo: null,
    forkedFromQuestionId: null,
    timesAsked: 0,
    timesAnswered: answerText ? 1 : 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    answer: answerText
      ? {
          id: `${id}-answer`,
          text: answerText,
          source: 'user_input',
          confidence: null,
          rationale: null,
          answeredAt: '2026-01-01T00:00:00.000Z',
        }
      : null,
  };
}

function cataloguePage(data: ReturnType<typeof catalogueEntry>[]) {
  return {
    data,
    totalCount: data.length,
    limit: 100,
    offset: 0,
    facets: { categories: [], answerTiers: [], answeredCount: 0, unansweredCount: 0 },
  };
}

/** What a correctly-seeded appliance returns: a row for every curated key. */
function fullCataloguePage(answers: Record<string, string> = {}) {
  return cataloguePage(
    curatedQuestions().map((question) => catalogueEntry(question, answers[question.key] ?? null)),
  );
}

function postCall() {
  return (fetchJson.mock.calls as Array<[string, FetchCallInit?]>).find(
    ([, init]) => init?.method === 'POST',
  );
}

beforeEach(() => {
  h.authToken = 'jwt-abc';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LifeDetailsSection', () => {
  it('fetches every curated key in a single call and renders an answered row compactly', async () => {
    fetchJson.mockResolvedValue(fullCataloguePage({ [BLOOD_TYPE_KEY]: 'O negative' }));

    render(<LifeDetailsSection />);

    expect(await screen.findByText(/O negative/)).toBeInTheDocument();

    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [url] = fetchJson.mock.calls[0] as [string];
    expect(url).toContain('/api/questions/catalogue?keys=');
    // No uuid rides in the request — that is the regression this section had.
    expect(url).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    // Every curated key rides in the one call — spot-check a few, not the whole list.
    expect(url).toContain(BLOOD_TYPE_KEY);
    expect(url).toContain(VOLUNTEER_KEY);
    const keysParam = new URL(url, 'http://localhost').searchParams.get('keys');
    expect(keysParam?.split(',')).toEqual(curatedQuestionKeys());
  });

  it('autosaves a compact open-ended answer typed into its Input, after a debounced pause', async () => {
    fetchJson.mockResolvedValue(fullCataloguePage());

    render(<LifeDetailsSection />);

    const row = (await screen.findByText('What is your blood type?')).closest('div')!;
    fireEvent.change(within(row).getByPlaceholderText('Answer…'), { target: { value: 'O negative' } });

    await waitFor(
      () => {
        expect(postCall()).toBeDefined();
        expect(JSON.parse(postCall()![1]!.body!)).toEqual({
          text: 'O negative',
          // The id the catalogue reported, not one this list carries.
          question: { id: serverIdFor(BLOOD_TYPE_KEY) },
        });
      },
      { timeout: 3000 },
    );
  });

  it('renders a yes_no question as two buttons, not a text field, and submits the clicked label', async () => {
    fetchJson.mockResolvedValue(fullCataloguePage());

    render(<LifeDetailsSection />);

    // Scoped to this question's own row — "Answer…" repeats across the many
    // other curated questions on the page.
    const row = (await screen.findByText('Do you volunteer for any organization?')).closest('div')!;
    const yesButton = within(row).getByRole('radio', { name: 'Yes' });
    expect(within(row).getByRole('radio', { name: 'No' })).toBeInTheDocument();
    expect(within(row).queryByPlaceholderText('Answer…')).not.toBeInTheDocument();

    fireEvent.click(yesButton);

    await waitFor(() => {
      expect(postCall()).toBeDefined();
      expect(postCall()?.[0]).toBe('/api/answers');
      expect(JSON.parse(postCall()![1]!.body!)).toEqual({
        text: 'Yes',
        question: { id: serverIdFor(VOLUNTEER_KEY) },
      });
    });

    // GET refires after the POST — once on mount, once on refetch.
    expect(fetchJson.mock.calls.filter(([, init]) => init?.method === undefined)).toHaveLength(2);
  });

  it('autosaves a narrative open-ended answer typed into its Textarea, after a debounced pause', async () => {
    fetchJson.mockResolvedValue(fullCataloguePage());

    render(<LifeDetailsSection />);

    // Scoped to this question's own row — the "Your answer…" Textarea
    // repeats across the other narrative-tier questions.
    const row = (
      await screen.findByText('Which hobby have you kept the longest, and for how many years?')
    ).closest('div')!;
    fireEvent.change(within(row).getByPlaceholderText('Your answer…'), {
      target: { value: 'Photography, going on 8 years now.' },
    });

    await waitFor(
      () => {
        expect(postCall()).toBeDefined();
        expect(JSON.parse(postCall()![1]!.body!)).toEqual({
          text: 'Photography, going on 8 years now.',
          question: { id: serverIdFor(HOBBY_KEY) },
        });
      },
      { timeout: 3000 },
    );
  });

  it('keys rows off question_key, so the same answers survive a different set of server ids', async () => {
    // The same appliance-independent list, re-seeded: every uuid is new, every
    // key is the same. Nothing about what the user sees may change.
    const page = fullCataloguePage({ [BLOOD_TYPE_KEY]: 'O negative' });
    for (const entry of page.data) {
      entry.id = `ffffffff-0000-4000-8000-${entry.id.slice(-12)}`;
    }

    fetchJson.mockResolvedValue(page);

    render(<LifeDetailsSection />);

    expect(await screen.findByText(/O negative/)).toBeInTheDocument();
    expect(screen.getByText('Do you volunteer for any organization?')).toBeInTheDocument();
  });

  it('renders no input for a curated question the catalogue has no row for, and says so loudly', async () => {
    // The failure mode this section shipped with: a curated question the
    // database has never heard of. It must not render a control that quietly
    // discards whatever is typed into it.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchJson.mockResolvedValue(
      cataloguePage(
        curatedQuestions()
          .filter((question) => question.key !== BLOOD_TYPE_KEY)
          .map((question) => catalogueEntry(question)),
      ),
    );

    render(<LifeDetailsSection />);

    expect(await screen.findByText('What foods are you allergic to?')).toBeInTheDocument();
    expect(screen.queryByText('What is your blood type?')).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(BLOOD_TYPE_KEY));
  });

  it('renders nothing at all, rather than dead inputs, when the catalogue knows none of the keys', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchJson.mockResolvedValue(cataloguePage([]));

    render(<LifeDetailsSection />);

    // The heading stays; every question, and every theme heading, is gone.
    expect(await screen.findByText('Life details')).toBeInTheDocument();
    expect(screen.queryByText('What is your blood type?')).not.toBeInTheDocument();
    expect(screen.queryByText('Health')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Answer…')).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('29 curated question(s) are missing'));
  });

  it('shows one error for the whole section when the fetch fails, with no question text rendered', async () => {
    fetchJson.mockRejectedValue(new Error('network error'));

    render(<LifeDetailsSection />);

    expect(await screen.findByText("Couldn't load this section.")).toBeInTheDocument();
    expect(screen.queryByText('What is your blood type?')).not.toBeInTheDocument();
  });
});
