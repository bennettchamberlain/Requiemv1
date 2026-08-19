import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnswerProvenance, confidenceLabel, isInferred } from './AnswerProvenance';

describe('AnswerProvenance', () => {
  it('reads as Manual for a user-authored answer', () => {
    render(<AnswerProvenance source="user_input" />);

    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('reads as Manual for imported and observed answers — only "inferred" is a guess', () => {
    const { rerender } = render(<AnswerProvenance source="imported" />);
    expect(screen.getByText('Manual')).toBeInTheDocument();

    rerender(<AnswerProvenance source="observed" />);
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('names an inferred answer AND its confidence band in words, not colour alone', () => {
    render(<AnswerProvenance source="inferred" confidence={0.93} />);

    expect(screen.getByText('Inferred · high confidence')).toBeInTheDocument();
  });

  it('keeps the exact number and the rationale in the tooltip rather than on the card', () => {
    render(
      <AnswerProvenance source="inferred" confidence={0.55} rationale="Two prior answers mention tea." />,
    );

    const badge = screen.getByText('Inferred · low confidence');
    expect(badge).toHaveAttribute('title', expect.stringContaining('0.55'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('Two prior answers mention tea.'));
  });

  it('still says Inferred when no confidence was ever recorded', () => {
    // Rows written before confidence capture, and the context-prompt writer,
    // leave the score NULL. Unknown must not read as certain.
    render(<AnswerProvenance source="inferred" confidence={null} />);

    expect(screen.getByText('Inferred')).toBeInTheDocument();
  });
});

describe('confidenceLabel', () => {
  it('bands the score the same way the backend prompt describes it', () => {
    expect(confidenceLabel(0.95)).toBe('high confidence');
    expect(confidenceLabel(0.9)).toBe('high confidence');
    expect(confidenceLabel(0.7)).toBe('good confidence');
    expect(confidenceLabel(0.4)).toBe('low confidence');
    expect(confidenceLabel(0.2)).toBe('very low confidence');
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
