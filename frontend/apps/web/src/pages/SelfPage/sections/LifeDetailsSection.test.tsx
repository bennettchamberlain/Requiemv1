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

type FetchCalls = Array<[string, FetchCallInit?]>;

function callsWithMethod(method: string): FetchCalls {
  return (fetchJson.mock.calls as FetchCalls).filter(([, init]) => init?.method === method);
}

// Curated KEYS, not ids: `question_id` is minted per appliance, so a test that
// hardcoded one would be asserting the very coupling this list exists to avoid.
// A yes_no question, a narrative open_ended one, a compact open_ended one and a
// multiple_choice one with options, so each control type is exercised against
// the real curated list.
const VOLUNTEER_KEY = 'volunteering';
const HOBBY_KEY = 'longest_hobby';
const BLOOD_TYPE_KEY = 'blood_type';
const MORNING_PERSON_KEY = 'morning_person_or_night_owl';

/** The row's own DOM subtree — both grid cells — for scoping a query. */
function rowFor(questionKey: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-question-key="${questionKey}"]`);
  if (!row) {
    throw new Error(`no row rendered for question ${questionKey}`);
  }

  return row;
}

function questionFor(key: string): CuratedQuestion {
  const question = curatedQuestions().find((candidate) => candidate.key === key);
  if (!question) {
    throw new Error(`${key} is not a curated question`);
  }

  return question;
}

/**
 * The uuid the catalogue reports for a curated key on THIS database. Derived
 * from the key so the test never invents an id/key pairing by hand, and
 * deliberately unlike anything in lifeDetails.ts — an assertion on it passes
 * only because the component read the id off the response.
 */
function serverIdFor(key: string): string {
  const index = curatedQuestionKeys().indexOf(key);

  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function catalogueEntry(
  key: string,
  answerText: string | null = null,
  answerOverrides: { source?: string; confidence?: number | null; rationale?: string | null } = {},
) {
  const question = questionFor(key);
  const id = serverIdFor(key);

  return {
    id,
    key,
    text: question.text,
    category: question.category,
    answerTier: question.tier,
    questionType: question.questionType,
    frequencyRecommendation: 'monthly',
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
          ...answerOverrides,
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
    curatedQuestions().map((question) => catalogueEntry(question.key, answers[question.key])),
  );
}

beforeEach(() => {
  h.authToken = 'jwt-abc';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LifeDetailsSection', () => {
  it('fetches every curated key in a single call and renders the answer in full', async () => {
    // A long answer, because the bug this replaced rendered the row as one
    // truncated line with the question and answer run together.
    const long =
      'O negative, which I only found out when I tried to donate blood in 2019 and they told me at the desk.';
    fetchJson.mockResolvedValue(fullCataloguePage({ [BLOOD_TYPE_KEY]: long }));

    render(<LifeDetailsSection />);

    expect(await screen.findByText(long)).toBeInTheDocument();

    // Question and answer are separate cells, not one run-together sentence.
    const row = rowFor(BLOOD_TYPE_KEY);
    expect(within(row).getByText('What is your blood type?')).not.toContainElement(screen.getByText(long));

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

    await screen.findByText('What is your blood type?');
    // Located by `rowFor`, not `.closest('div')`: the question and its answer
    // are sibling grid cells, so there is no single ancestor <div> wrapping
    // just this row.
    const input = within(rowFor(BLOOD_TYPE_KEY)).getByPlaceholderText('Answer…');
    fireEvent.change(input, { target: { value: 'O negative' } });

    // Kept from the row-layout tests: the input fills its cell rather than
    // sitting at a fixed 20rem.
    expect(input).toHaveClass('w-full');
    expect(input).not.toHaveClass('w-80');

    await waitFor(
      () => {
        const [postCall] = callsWithMethod('POST');
        expect(postCall).toBeDefined();
        expect(JSON.parse(postCall![1]!.body!)).toEqual({
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
    await screen.findByText('Do you volunteer for any organization?');
    const row = rowFor(VOLUNTEER_KEY);
    const yesButton = within(row).getByRole('radio', { name: 'Yes' });
    expect(within(row).getByRole('radio', { name: 'No' })).toBeInTheDocument();
    expect(within(row).queryByPlaceholderText('Answer…')).not.toBeInTheDocument();

    fireEvent.click(yesButton);

    await waitFor(() => {
      const [postCall] = callsWithMethod('POST');
      expect(postCall).toBeDefined();
      expect(postCall?.[0]).toBe('/api/answers');
      expect(JSON.parse(postCall![1]!.body!)).toEqual({
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
    await screen.findByText('Which hobby have you kept the longest, and for how many years?');
    fireEvent.change(within(rowFor(HOBBY_KEY)).getByPlaceholderText('Your answer…'), {
      target: { value: 'Photography, going on 8 years now.' },
    });

    await waitFor(
      () => {
        const [postCall] = callsWithMethod('POST');
        expect(postCall).toBeDefined();
        expect(JSON.parse(postCall![1]!.body!)).toEqual({
          text: 'Photography, going on 8 years now.',
          question: { id: serverIdFor(HOBBY_KEY) },
        });
      },
      { timeout: 3000 },
    );
  });

  it('shows one error for the whole section when the fetch fails, with no question text rendered', async () => {
    fetchJson.mockRejectedValue(new Error('network error'));

    render(<LifeDetailsSection />);

    expect(await screen.findByText("Couldn't load this section.")).toBeInTheDocument();
    expect(screen.queryByText('What is your blood type?')).not.toBeInTheDocument();
  });

  it('labels an inferred answer with its confidence band, and a hand-written one as Manual', async () => {
    fetchJson.mockResolvedValue(
      cataloguePage([
        catalogueEntry(BLOOD_TYPE_KEY, 'O negative', {
          source: 'inferred',
          confidence: 0.72,
          rationale: 'A 2019 donation reminder names it.',
        }),
        catalogueEntry(HOBBY_KEY, 'Photography'),
      ]),
    );

    render(<LifeDetailsSection />);

    const badge = await screen.findByText('Inferred · good confidence');
    expect(rowFor(BLOOD_TYPE_KEY)).toContainElement(badge);
    expect(badge).toHaveAttribute('title', expect.stringContaining('0.72'));
    expect(within(rowFor(HOBBY_KEY)).getByText('Manual')).toBeInTheDocument();
  });

  it('edits an existing answer with a PATCH carrying text alone, so the API re-stamps it as user-authored', async () => {
    fetchJson.mockResolvedValue(
      cataloguePage([
        catalogueEntry(BLOOD_TYPE_KEY, 'AB positive, I think?', { source: 'inferred', confidence: 0.41 }),
      ]),
    );

    render(<LifeDetailsSection />);

    fireEvent.click(await screen.findByRole('button', { name: /Edit your answer to/ }));

    const editor = within(rowFor(BLOOD_TYPE_KEY)).getByRole('textbox');
    expect(editor).toHaveValue('AB positive, I think?');

    fireEvent.change(editor, { target: { value: 'O negative' } });
    fireEvent.click(within(rowFor(BLOOD_TYPE_KEY)).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const [patchCall] = callsWithMethod('PATCH');
      expect(patchCall).toBeDefined();
      // The answer id off the response, same as the question id.
      expect(patchCall?.[0]).toBe(`/api/answers/${serverIdFor(BLOOD_TYPE_KEY)}-answer`);
      // Text ONLY: naming a source here would opt out of the API's
      // user-correction flip, leaving the row badged as a machine inference.
      expect(JSON.parse(patchCall![1]!.body!)).toEqual({ text: 'O negative' });
    });

    // Never a second POST — editing must not pile up a duplicate answer row.
    expect(callsWithMethod('POST')).toHaveLength(0);
  });

  it('cancels an edit back to the answer without writing anything', async () => {
    fetchJson.mockResolvedValue(cataloguePage([catalogueEntry(BLOOD_TYPE_KEY, 'O negative')]));

    render(<LifeDetailsSection />);

    fireEvent.click(await screen.findByRole('button', { name: /Edit your answer to/ }));

    const row = rowFor(BLOOD_TYPE_KEY);
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'something else entirely' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));

    expect(within(rowFor(BLOOD_TYPE_KEY)).getByText('O negative')).toBeInTheDocument();
    expect(callsWithMethod('PATCH')).toHaveLength(0);
    expect(callsWithMethod('POST')).toHaveLength(0);
  });

  it('re-picks an answered options question from its buttons rather than a text box', async () => {
    fetchJson.mockResolvedValue(
      cataloguePage([
        catalogueEntry(MORNING_PERSON_KEY, "I'm not sure, I haven't really thought about it.", {
          source: 'inferred',
          confidence: 0.44,
        }),
      ]),
    );

    render(<LifeDetailsSection />);

    fireEvent.click(await screen.findByRole('button', { name: /Edit your answer to/ }));

    const row = rowFor(MORNING_PERSON_KEY);
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('radio', { name: 'Night owl' }));

    await waitFor(() => {
      const [patchCall] = callsWithMethod('PATCH');
      expect(patchCall).toBeDefined();
      expect(patchCall?.[0]).toBe(`/api/answers/${serverIdFor(MORNING_PERSON_KEY)}-answer`);
      expect(JSON.parse(patchCall![1]!.body!)).toEqual({ text: 'Night owl' });
    });
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

    expect(await screen.findByText('O negative')).toBeInTheDocument();
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
          .map((question) => catalogueEntry(question.key)),
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
});
