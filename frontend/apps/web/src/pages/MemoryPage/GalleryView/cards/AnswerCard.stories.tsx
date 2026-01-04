import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { AnswerCard, ANSWER_FRAGMENT } from './AnswerCard';

type StoryProps = ComponentProps<typeof AnswerCard> & {
  question: string;
  answer: string;
};

const meta: Meta<StoryProps> = {
  component: AnswerCard,

  parameters: {
    layout: 'centered',
  },

  argTypes: {
    question: {
      control: 'text',
    },

    answer: {
      control: 'text',
    },
  },
};

export default meta;

type Story = StoryObj<StoryProps>;

export const Default: Story = {
  args: {
    question: 'Sample question?',
    answer: 'Sample answer text for the question.',
    onClick: fn(),
  },

  render: (args) => {
    const answer = {
      __typename: 'AnswerType' as const,
      id: 'mock-id-1',
      answer: args.answer,
      question: {
        __typename: 'QuestionType' as const,
        id: 'mock-question-id-1',
        text: args.question,
      },
    };

    const maskedAnswer = makeFragmentData(answer, ANSWER_FRAGMENT);

    return (
      <SearchGrid>
        <AnswerCard answer={maskedAnswer} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
