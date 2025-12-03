import type { User } from '@ci/domains/user';

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
  isPrivateTo?: string | null;
}

export interface UpdateAnswerDto {
  answer_text?: string;
}
