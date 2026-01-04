import { Images } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { Empty } from '@/pages/MemoryPage/Components';

import { useMemoryServiceNext } from '../useMemoryServiceNext';

import { AnswerCard } from './cards/AnswerCard';
import { BrowserActivityCard } from './cards/BrowserActivityCard';
import { CommunicationCard } from './cards/CommunicationCard';
import { ConceptCard } from './cards/ConceptCard';
import { ContentCard } from './cards/ContentCard';
import { EventCard } from './cards/EventCard';
import { FileCard } from './cards/FileCard';
import { ItemCard } from './cards/ItemCard';
import { PersonCard } from './cards/PersonCard';
import { PlaceCard } from './cards/PlaceCard';
import { ThreadCard } from './cards/ThreadCard';
import { SearchGrid } from './SearchGrid';

export function GalleryView() {
  const [searchParams] = useSearchParams();
  const { data } = useMemoryServiceNext({
    searchQuery: searchParams.get('search') || '',
    excludeTypes: searchParams.get('excludedEntityTypes')?.split(',') || [],
  });

  if (data.length === 0) {
    return (
      <Empty
        title="No results found"
        description="Connect your data sources or try a different search to see content here"
        icon={Images}
      />
    );
  }

  return (
    <SearchGrid className="p-4 pt-0">
      {data.map((item) => {
        switch (item.__typename) {
          case 'PersonType':
            return <PersonCard key={item.id} person={item} onClick={() => {}} />;

          case 'PlaceType':
            return <PlaceCard key={item.id} place={item} onClick={() => {}} />;

          case 'EventType':
            return <EventCard key={item.id} event={item} onClick={() => {}} />;

          case 'ThreadType':
            return <ThreadCard key={item.id} thread={item} onClick={() => {}} />;

          case 'FileType':
            return <FileCard key={item.id} file={item} onClick={() => {}} />;

          case 'CommunicationType':
            return <CommunicationCard key={item.id} communication={item} onClick={() => {}} />;

          case 'ItemType':
            return <ItemCard key={item.id} item={item} onClick={() => {}} />;

          case 'ContentType':
            return <ContentCard key={item.id} content={item} onClick={() => {}} />;

          case 'AnswerType':
            return <AnswerCard key={item.id} answer={item} onClick={() => {}} />;

          case 'ConceptType':
            return <ConceptCard key={item.id} concept={item} onClick={() => {}} />;

          case 'BrowserActivityType':
            return <BrowserActivityCard key={item.id} browserActivity={item} onClick={() => {}} />;

          default:
            return null;
        }
      })}
    </SearchGrid>
  );
}
