import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { ANSWER_FRAGMENT, AnswerGridItem } from './AnswerGridItem';

const makeAnswer = (overrides: Record<string, unknown> = {}) =>
  makeFragmentData(
    {
      __typename: 'AnswerType' as const,
      id: 'a1',
      answer: 'Because it terminates at the base case.',
      question: { __typename: 'QuestionType' as const, id: 'q1', text: 'Why does recursion work?' },
      ...overrides,
    },
    ANSWER_FRAGMENT,
  );

describe('AnswerGridItem', () => {
  it('renders the question and answer text', () => {
    renderWithProviders(<AnswerGridItem answer={makeAnswer()} />);

    expect(screen.getByText('Why does recursion work?')).toBeInTheDocument();
    expect(screen.getByText('Because it terminates at the base case.')).toBeInTheDocument();
  });

  it('marks an inferred answer with the amber dot and its confidence band', () => {
    renderWithProviders(
      <AnswerGridItem
        answer={makeAnswer({
          answerSource: 'inferred',
          answerConfidence: 0.93,
          answerRationale: 'You said so in the coffee question.',
        })}
      />,
    );

    // Compact form: the bare band word is visible, the full wording is the
    // accessible name (see AnswerProvenance).
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Inferred, high confidence')).toHaveClass('sr-only');
  });

  it('marks a user-authored answer with the green dot', () => {
    renderWithProviders(<AnswerGridItem answer={makeAnswer({ answerSource: 'user_input' })} />);

    expect(screen.getByText('Answered by you')).toHaveClass('sr-only');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    renderWithProviders(<AnswerGridItem answer={makeAnswer()} onClick={onClick} />);

    fireEvent.click(screen.getByText('Why does recursion work?'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
