import type { User } from '@ci/domains/user';

import type { Thread } from '../conversations/types';

export interface Action {
  id: string;

  title: string | null;
  text: string | null;

  threadId: string | null;

  thread?: Thread;
  user?: User;
  tags?: string[];
}

export interface Answer {
  id: string;

  ragAnswer: string;
  answer: string;

  user?: User;
  question?: Question;
}

export interface Question {
  id: string;

  category: string;
  text: string;
  answer: string;

  user?: User;
}

export interface UpdateAnswerDto {
  rag_answer_1?: string;
}
