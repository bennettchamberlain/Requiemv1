import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { curatedQuestionIds } from './lifeDetails';
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

// A curated yes_no question ("Do you volunteer for any organization?") and a
// curated narrative open_ended one ("Which hobby have you kept the longest,
// and for how many years?") — real ids from lifeDetails.ts, exercised end to
// end so the test proves the real curated list renders each control type.
const VOLUNTEER_ID = 'e9afce2b-acb7-4a73-a1c0-3394add95b52';
const HOBBY_ID = '8ac610c9-27aa-4505-b79f-bc89c4f50dca';
const BLOOD_TYPE_ID = 'e87d2be3-28f3-4916-ab12-fda1931c2479';

function catalogueEntry(id: string, text: string, answerText: string | null = null) {
  return {
    id,
    text,
    category: 'Health & Body',
    answerTier: 'factual',
    questionType: 'open_ended',
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

beforeEach(() => {
  h.authToken = 'jwt-abc';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LifeDetailsSection', () => {
  it('fetches every curated id in a single call and renders an answered row compactly', async () => {
    fetchJson.mockResolvedValue(
      cataloguePage([catalogueEntry(BLOOD_TYPE_ID, 'What is your blood type?', 'O negative')]),
    );

    render(<LifeDetailsSection />);

    expect(await screen.findByText(/O negative/)).toBeInTheDocument();

    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [url] = fetchJson.mock.calls[0] as [string];
    expect(url).toContain('/api/questions/catalogue?ids=');
    // Every curated id rides in the one call — spot-check a few, not the whole list.
    expect(url).toContain(BLOOD_TYPE_ID);
    expect(url).toContain(VOLUNTEER_ID);
    const idsParam = new URL(url, 'http://localhost').searchParams.get('ids');
    expect(idsParam?.split(',')).toHaveLength(curatedQuestionIds().length);
  });

  it('autosaves a compact open-ended answer typed into its Input, after a debounced pause', async () => {
    fetchJson.mockResolvedValue(cataloguePage([]));

    render(<LifeDetailsSection />);

    const row = (await screen.findByText('What is your blood type?')).closest('div')!;
    fireEvent.change(within(row).getByPlaceholderText('Answer…'), { target: { value: 'O negative' } });

    await waitFor(
      () => {
        const postCall = (fetchJson.mock.calls as Array<[string, FetchCallInit?]>).find(
          ([, init]) => init?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        expect(JSON.parse(postCall![1]!.body!)).toEqual({ text: 'O negative', question: { id: BLOOD_TYPE_ID } });
      },
      { timeout: 3000 },
    );
  });

  it('renders a yes_no question as two buttons, not a text field, and submits the clicked label', async () => {
    fetchJson.mockResolvedValue(cataloguePage([]));

    render(<LifeDetailsSection />);

    // Scoped to this question's own row — "Answer…" repeats across the many
    // other curated questions on the page.
    const row = (await screen.findByText('Do you volunteer for any organization?')).closest('div')!;
    const yesButton = within(row).getByRole('radio', { name: 'Yes' });
    expect(within(row).getByRole('radio', { name: 'No' })).toBeInTheDocument();
    expect(within(row).queryByPlaceholderText('Answer…')).not.toBeInTheDocument();

    fireEvent.click(yesButton);

    await waitFor(() => {
      const postCall = (fetchJson.mock.calls as Array<[string, FetchCallInit?]>).find(
        ([, init]) => init?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      expect(postCall?.[0]).toBe('/api/answers');
      expect(JSON.parse(postCall![1]!.body!)).toEqual({ text: 'Yes', question: { id: VOLUNTEER_ID } });
    });

    // GET refires after the POST — once on mount, once on refetch.
    expect(fetchJson.mock.calls.filter(([, init]) => init?.method === undefined)).toHaveLength(2);
  });

  it('autosaves a narrative open-ended answer typed into its Textarea, after a debounced pause', async () => {
    fetchJson.mockResolvedValue(cataloguePage([]));

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
        const postCall = (fetchJson.mock.calls as Array<[string, FetchCallInit?]>).find(
          ([, init]) => init?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        expect(JSON.parse(postCall![1]!.body!)).toEqual({
          text: 'Photography, going on 8 years now.',
          question: { id: HOBBY_ID },
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
});
