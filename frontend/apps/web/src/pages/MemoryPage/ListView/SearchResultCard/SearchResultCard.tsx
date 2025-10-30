import type { SearchResult } from '../../types';

import { AnswerCard } from './AnswerCard';
import { EntityCard } from './EntityCard';
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
    case 'entity':
      return <EntityCard result={result} />;
    default:
      return null;
  }
}
