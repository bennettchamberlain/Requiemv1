import type { SearchResult } from '../../types';

import { AnswerCard } from './AnswerCard';
import { ImageCard } from './ImageCard';
import { QuestionCard } from './QuestionCard';

export interface Props {
  result: SearchResult;
}

export function SearchResultCard({ result }: Props) {
  switch (result.type) {
    case 'answer':
      return <AnswerCard result={result} />;
    case 'question':
      return <QuestionCard result={result} />;
    case 'image':
    case 'photo':
      return <ImageCard result={result} />;
    default:
      return null;
  }
}
