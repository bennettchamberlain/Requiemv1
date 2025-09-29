import type { Thread } from '@ci/domains/conversations';
import type { User } from '@ci/domains/user';

export interface Action {
  id: string;

  title: string | null;
  text: string | null;
  imageUrl: string | null;

  threadId: string | null;

  thread?: Thread;
  user?: User;
  tags?: string[];
}

export interface Answer {
  id: string;

  answer: string;
  answerConfidence?: number;
  answerSource: string;
  answerMethod?: string;
  answeredAt: Date;
  isSensitive: boolean;
  sharingLevel: string;

  user?: User;
  question?: Question;
}

export interface Question {
  id: string;

  category: string;
  text: string;
  contextTags?: string[];
  questionType?: string;
  isSeedQuestion: boolean;
  isActive: boolean;
  createdByLlm: boolean;
  frequencyRecommendation?: string;
  timesAsked: number;
  timesAnswered: number;
}

export interface CreateActionDto {
  title: string;
  text: string;
  imageUrl?: string;
  priority?: number;
  threadId: string;
}

export interface CreateAnswerDto {
  id?: string;
  text: string;
  question: {
    id: string;
  };
}

export interface CreateQuestionDto {
  id?: string;
  text: string;
  subcategory?: string;
}

export interface UpdateAnswerDto {
  answer_text?: string;
}
