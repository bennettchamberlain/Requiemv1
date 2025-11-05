import type { MemoryItem, SearchResult } from '../../types.ts';

import { AnswerCard } from './AnswerCard.tsx';
import { BrowserActivityCard } from './BrowserActivityCard';
import { CommunicationCard } from './CommunicationCard.tsx';
import { ContentCard } from './ContentCard.tsx';
import { EntityCard } from './EntityCard.tsx';
import { EventCard } from './EventCard';
import { ImageCard } from './ImageCard.tsx';
import { LocationCard } from './LocationCard';
import { OtherCard } from './OtherCard';
import { PersonCard } from './PersonCard';
import { QuestionCard } from './QuestionCard.tsx';

export interface Props {
  result: SearchResult | MemoryItem;
}

function getOtherCardType(result: MemoryItem | undefined): SearchResult {
  return result.category === 'Location' ? (
    <LocationCard result={result as MemoryItem} />
  ) : (
    <OtherCard result={result as MemoryItem} />
  );
}

export function ResultCard({ result }: Props) {
  console.log('result', result);
  switch (result.type) {
    case 'answer':
      return <AnswerCard result={result} />;
    case 'question':
      return <QuestionCard result={result} />;
    case 'image':
    case 'photo':
      return <ImageCard result={result} />;
    case 'entity':
    case 'graph_node':
      return <EntityCard result={result} />;
    case 'content':
      return <ContentCard result={result as MemoryItem} />;
    case 'communication':
      return <CommunicationCard result={result as MemoryItem} />;
    case 'browser':
      return <BrowserActivityCard result={result as MemoryItem} />;
    case 'event':
      return <EventCard result={result as MemoryItem} />;
    case 'person':
      return <PersonCard result={result as MemoryItem} />;
    case 'other':
      return getOtherCardType(result);
    default:
      return null;
  }
}
