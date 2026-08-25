import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnswerProvenance, confidenceLabel, isInferred } from './AnswerProvenance';

/** The dot is aria-hidden, so it is found by class rather than by role. */
function dot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('span.rounded-full');
  if (!el) {
    throw new Error('no provenance dot rendered');
  }

  return el;
}

describe('AnswerProvenance', () => {
  it('shows a green dot and no visible word for a user-authored answer', () => {
    render(<AnswerProvenance source="user_input" />);

    expect(dot()).toHaveClass('bg-emerald-500');
    // The badge face is the dot alone — the words moved to the accessible name.
    expect(screen.getByText('Answered by you')).toHaveClass('sr-only');
    expect(screen.getByTitle('You wrote this answer')).toBeInTheDocument();
  });

  it('treats imported and observed answers as manual — only "inferred" is a guess', () => {
    for (const source of ['imported', 'observed', null, undefined]) {
      const { unmount } = render(<AnswerProvenance source={source} />);
      expect(dot()).toHaveClass('bg-emerald-500');
      unmount();
    }
  });

  it('shows an amber dot and the bare confidence band for an inferred answer', () => {
    render(<AnswerProvenance source="inferred" confidence={0.82} />);

    expect(dot()).toHaveClass('bg-amber-500');
    // The band word alone on the visible face — "confidence" is implicit
    // there, and spelled out only in the sr-only text and the tooltip.
    const visible = screen.getByText('good');
    expect(visible).toHaveAttribute('aria-hidden', 'true');
    expect(visible).toHaveTextContent(/^good$/);
  });

  it('shows a red dot and no band when the question has no answer yet', () => {
    render(<AnswerProvenance answered={false} />);

    expect(dot()).toHaveClass('bg-red-500');
    expect(screen.getByText('No answer yet')).toHaveClass('sr-only');
  });

  it('keeps the distinction in words for a screen reader, not colour alone', () => {
    // The compact face is a dot plus one ambiguous word ("good"), so the full
    // meaning has to survive in the accessible name.
    render(<AnswerProvenance source="inferred" confidence={0.95} />);

    expect(screen.getByText('Inferred, high confidence')).toHaveClass('sr-only');
  });

  it('keeps the exact number and the rationale in the tooltip rather than on the badge', () => {
    render(
      <AnswerProvenance source="inferred" confidence={0.42} rationale="Three restaurant visits." />,
    );

    const badge = screen.getByText('low').closest('[title]');
    expect(badge).toHaveAttribute('title', expect.stringContaining('0.42'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('Three restaurant visits.'));
    expect(screen.queryByText('0.42')).not.toBeInTheDocument();
  });

  it('still marks an inferred answer when no confidence was ever recorded', () => {
    render(<AnswerProvenance source="inferred" confidence={null} />);

    expect(dot()).toHaveClass('bg-amber-500');
    expect(screen.getByText('Inferred, confidence not recorded')).toHaveClass('sr-only');
  });
});

describe('confidenceLabel', () => {
  it('bands the score the same way the backend prompt describes it', () => {
    expect(confidenceLabel(1)).toBe('high');
    expect(confidenceLabel(0.9)).toBe('high');
    expect(confidenceLabel(0.89)).toBe('good');
    expect(confidenceLabel(0.7)).toBe('good');
    expect(confidenceLabel(0.69)).toBe('low');
    expect(confidenceLabel(0.4)).toBe('low');
    expect(confidenceLabel(0.39)).toBe('very low');
    expect(confidenceLabel(0)).toBe('very low');
  });
});

describe('isInferred', () => {
  it('is true only for the inferred source', () => {
    expect(isInferred('inferred')).toBe(true);
    expect(isInferred('user_input')).toBe(false);
    expect(isInferred(null)).toBe(false);
    expect(isInferred(undefined)).toBe(false);
  });
});
