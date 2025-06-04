import type { User } from '@ci/domains/user';

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
