/**
 * Two data-mutation surfaces on the rail that had zero coverage:
 *
 *  - BrainDump: free text in, cards out (`onBreakDown`). Success, "nothing
 *    came back", and a failed request all have to say something different,
 *    and only a real failure may erase what the user typed.
 *  - Personalize / apply: "How you'd do it" fetches a per-candidate brief and
 *    can push its steps back as new cards. A failed personalize used to leave
 *    the spinner just stop with no note anywhere in the DOM — the `applyNote`
 *    paragraph lived inside a block gated on `personalized`, which a failed
 *    personalize never sets. Fixed alongside these tests (moved the note out
 *    from under that gate) so the error path has somewhere to land.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyHowYoudDoIt, composeHowYoudDoIt } from '@/api/usePersonaCompose';
import type { ScheduleCandidate } from '@/api/useScheduleCandidates';

import { TaskSlate } from './TaskSlate';

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: 'test-token' }],
}));

vi.mock('@/common/feature', () => ({
  useFeatures: () => ({ isFeatureEnabled: (name: string) => name === 'chat.page' }),
}));

vi.mock('@/components/ChatWithAgent', () => ({
  ChatWithAgentMenu: () => <button type="button">Chat</button>,
}));

vi.mock('@/api/usePersonaCompose', () => ({
  composeHowYoudDoIt: vi.fn(),
  applyHowYoudDoIt: vi.fn(),
}));

const mockedCompose = vi.mocked(composeHowYoudDoIt);
const mockedApply = vi.mocked(applyHowYoudDoIt);

function candidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return {
    id: 'c1',
    title: 'Book the dentist',
    description: null,
    rationale: 'You wrote this down.',
    rationaleSources: [{ kind: 'answer', id: 'a1', note: null }],
    windowStart: new Date(2026, 7, 3).toISOString(),
    windowEnd: new Date(2026, 7, 10).toISOString(),
    timeFlex: 'week',
    durationMinutes: 30,
    l0Class: null,
    fitScore: null,
    status: 'open',
    generator: 'braindump/llm',
    confidence: 0.9,
    personalization: null,
    ...overrides,
  };
}

const NOOP = { loading: false, onDecline: () => {}, onSnooze: () => {} };

beforeEach(() => {
  mockedCompose.mockReset();
  mockedApply.mockReset();
});

describe('BrainDump — turning a note into cards', () => {
  it('submits on Enter but breaks the line on Shift+Enter', async () => {
    const onBreakDown = vi.fn(async () => 0);
    render(<TaskSlate candidates={[]} {...NOOP} onBreakDown={onBreakDown} />);

    const textarea = screen.getByLabelText('What do you need to do?');
    fireEvent.change(textarea, { target: { value: 'call the plumber' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onBreakDown).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onBreakDown).toHaveBeenCalledWith('call the plumber'));
  });

  it('does not submit blank or whitespace-only text', () => {
    const onBreakDown = vi.fn(async () => 0);
    render(<TaskSlate candidates={[]} {...NOOP} onBreakDown={onBreakDown} />);

    const textarea = screen.getByLabelText('What do you need to do?');
    expect(screen.getByRole('button', { name: /break into tasks/i })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onBreakDown).not.toHaveBeenCalled();
  });

  it('reports how many cards came back and clears the box', async () => {
    const onBreakDown = vi.fn(async () => 2);
    render(<TaskSlate candidates={[]} {...NOOP} onBreakDown={onBreakDown} />);

    const textarea = screen.getByLabelText('What do you need to do?');
    fireEvent.change(textarea, { target: { value: 'dentist, call mum, pay rent' } });
    fireEvent.click(screen.getByRole('button', { name: /break into tasks/i }));

    await screen.findByText('Added 2 cards.');
    expect(textarea).toHaveValue('');
  });

  it('uses the singular for exactly one card', async () => {
    const onBreakDown = vi.fn(async () => 1);
    render(<TaskSlate candidates={[]} {...NOOP} onBreakDown={onBreakDown} />);

    fireEvent.change(screen.getByLabelText('What do you need to do?'), { target: { value: 'dentist' } });
    fireEvent.click(screen.getByRole('button', { name: /break into tasks/i }));

    await screen.findByText('Added 1 card.');
  });

  it('says nothing came back, and keeps the typed text, when the split yields no cards', async () => {
    const onBreakDown = vi.fn(async () => 0);
    render(<TaskSlate candidates={[]} {...NOOP} onBreakDown={onBreakDown} />);

    const textarea = screen.getByLabelText('What do you need to do?');
    fireEvent.change(textarea, { target: { value: 'asdkjhasdkjh' } });
    fireEvent.click(screen.getByRole('button', { name: /break into tasks/i }));

    await screen.findByText('Nothing came back — try naming the tasks more plainly.');
    // Nothing landed, so the draft must not be thrown away.
    expect(textarea).toHaveValue('asdkjhasdkjh');
  });

  it('shows a real error message and keeps the draft when the request fails', async () => {
    const onBreakDown = vi.fn(async () => {
      throw new Error('network down');
    });
    render(<TaskSlate candidates={[]} {...NOOP} onBreakDown={onBreakDown} />);

    const textarea = screen.getByLabelText('What do you need to do?');
    fireEvent.change(textarea, { target: { value: 'dentist, call mum' } });
    fireEvent.click(screen.getByRole('button', { name: /break into tasks/i }));

    await screen.findByText('Could not break that down. Try again shortly.');
    expect(textarea).toHaveValue('dentist, call mum');
  });

  it('disables the box and shows a busy state while the request is in flight', async () => {
    let release!: (n: number) => void;
    const onBreakDown = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));
    render(<TaskSlate candidates={[]} {...NOOP} onBreakDown={onBreakDown} />);

    const textarea = screen.getByLabelText('What do you need to do?');
    fireEvent.change(textarea, { target: { value: 'dentist' } });
    fireEvent.click(screen.getByRole('button', { name: /break into tasks/i }));

    expect(await screen.findByRole('button', { name: /splitting/i })).toBeDisabled();
    expect(textarea).toBeDisabled();

    release(1);
    await screen.findByText('Added 1 card.');
    expect(textarea).not.toBeDisabled();
  });
});

describe('Personalize — "How you\'d do it"', () => {
  it('fetches a brief, swaps in the personalized rationale, and expands the steps', async () => {
    mockedCompose.mockResolvedValue({
      task: { title: 'Book the dentist', openQuestions: [], constraints: [] },
      personaBrief: 'Call before 9am — that clinic answers fastest then.',
      approach: [{ title: 'Call the clinic' }, { title: 'Ask for a morning slot' }],
      people: [],
      evidence: [],
      followUps: [],
      confidence: 0.8,
      hasSignal: true,
    });

    render(<TaskSlate candidates={[candidate()]} {...NOOP} />);

    fireEvent.click(screen.getByLabelText('Personalize Book the dentist'));

    expect(mockedCompose).toHaveBeenCalledWith('test-token', 'Book the dentist', {
      includeRecall: true,
      candidateId: 'c1',
    });

    await screen.findByText('Call before 9am — that clinic answers fastest then.');
    expect(screen.getByText('1. Call the clinic')).toBeInTheDocument();
    expect(screen.getByText('2. Ask for a morning slot')).toBeInTheDocument();
    expect(screen.getByText('for you')).toBeInTheDocument();
  });

  it('reuses an already-saved personalization instead of re-fetching it', async () => {
    render(
      <TaskSlate
        candidates={[
          candidate({
            personalization: {
              personaBrief: 'Saved from last time.',
              approach: [{ title: 'Do the saved thing' }],
            },
          }),
        ]}
        {...NOOP}
      />,
    );

    fireEvent.click(screen.getByLabelText('Personalize Book the dentist'));

    await screen.findByText('Saved from last time.');
    expect(mockedCompose).not.toHaveBeenCalled();
  });

  it('adds the steps to Possibilities and reports how many were added', async () => {
    mockedCompose.mockResolvedValue({
      task: { title: 'Book the dentist', openQuestions: [], constraints: [] },
      personaBrief: 'Call before 9am.',
      approach: [{ title: 'Call the clinic' }],
      people: [],
      evidence: [],
      followUps: [],
      confidence: 0.8,
      hasSignal: true,
    });
    mockedApply.mockResolvedValue({ added: 2 });

    render(<TaskSlate candidates={[candidate()]} {...NOOP} />);

    fireEvent.click(screen.getByLabelText('Personalize Book the dentist'));
    fireEvent.click(await screen.findByRole('button', { name: /add steps to possibilities/i }));

    await screen.findByText('Added 2 steps.');
    expect(mockedApply).toHaveBeenCalledWith('test-token', expect.objectContaining({ personaBrief: 'Call before 9am.' }));
  });

  it('says there was nothing to add when apply reports zero', async () => {
    mockedCompose.mockResolvedValue({
      task: { title: 'Book the dentist', openQuestions: [], constraints: [] },
      personaBrief: 'Call before 9am.',
      approach: [{ title: 'Call the clinic' }],
      people: [],
      evidence: [],
      followUps: [],
      confidence: 0.8,
      hasSignal: true,
    });
    mockedApply.mockResolvedValue({ added: 0 });

    render(<TaskSlate candidates={[candidate()]} {...NOOP} />);

    fireEvent.click(screen.getByLabelText('Personalize Book the dentist'));
    fireEvent.click(await screen.findByRole('button', { name: /add steps to possibilities/i }));

    await screen.findByText('Nothing to add.');
  });

  it('shows a real error message when applying the steps fails', async () => {
    mockedCompose.mockResolvedValue({
      task: { title: 'Book the dentist', openQuestions: [], constraints: [] },
      personaBrief: 'Call before 9am.',
      approach: [{ title: 'Call the clinic' }],
      people: [],
      evidence: [],
      followUps: [],
      confidence: 0.8,
      hasSignal: true,
    });
    mockedApply.mockRejectedValue(new Error('server error'));

    render(<TaskSlate candidates={[candidate()]} {...NOOP} />);

    fireEvent.click(screen.getByLabelText('Personalize Book the dentist'));
    fireEvent.click(await screen.findByRole('button', { name: /add steps to possibilities/i }));

    await screen.findByText('Could not add steps.');
  });

  it('shows a real error message when the personalize request itself fails', async () => {
    mockedCompose.mockRejectedValue(new Error('network down'));

    render(<TaskSlate candidates={[candidate()]} {...NOOP} />);

    const button = screen.getByLabelText('Personalize Book the dentist');
    fireEvent.click(button);

    await screen.findByText('Could not personalize — try again shortly.');
    // The spinner must not get stuck — the button is clickable again.
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
