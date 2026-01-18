import { GlobalUID } from '@ci/common';
import { Images } from '@ci/shadcn/icons';
import { useSearchParams, useNavigate } from 'react-router-dom';

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
import { NoteCard } from './cards/NoteCard';
import { PersonCard } from './cards/PersonCard';
import { PlaceCard } from './cards/PlaceCard';
import { ThreadCard } from './cards/ThreadCard';
import { SearchGrid } from './SearchGrid';

export function GalleryView() {
  const [searchParams] = useSearchParams();

  const navigate = useNavigate();

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
          case 'AnswerType':
            return <AnswerCard key={item.id} answer={item} onClick={() => {}} />;

          case 'BrowserActivityType':
            return <BrowserActivityCard key={item.id} browserActivity={item} onClick={() => {}} />;

          case 'CommunicationType':
            return (
              <CommunicationCard
                key={item.id}
                communication={item}
                onClick={() => {
                  navigate(`/communications/${GlobalUID.parse('communication', item.id)}`);
                }}
              />
            );

          case 'ConceptType':
            return (
              <ConceptCard
                key={item.id}
                concept={item}
                onClick={() => {
                  navigate(`/concepts/${GlobalUID.parse('concept', item.id)}`);
                }}
              />
            );

          case 'ContentType':
            return (
              <ContentCard
                key={item.id}
                content={item}
                onClick={() => {
                  navigate(`/content/${GlobalUID.parse('content', item.id)}`);
                }}
              />
            );

          case 'EventType':
            return (
              <EventCard
                key={item.id}
                event={item}
                onClick={() => {
                  navigate(`/events/${GlobalUID.parse('event', item.id)}`);
                }}
              />
            );

          case 'FileType':
            return <FileCard key={item.id} file={item} />;

          case 'ItemType':
            return (
              <ItemCard
                key={item.id}
                item={item}
                onClick={() => {
                  navigate(`/items/${GlobalUID.parse('item', item.id)}`);
                }}
              />
            );

          case 'NoteType':
            return (
              <NoteCard
                key={item.id}
                note={item}
                onClick={() => {
                  navigate(`/notes/${GlobalUID.parse('note', item.id)}`);
                }}
              />
            );

          case 'PersonType':
            return (
              <PersonCard
                key={item.id}
                person={item}
                onClick={() => {
                  navigate(`/people/${GlobalUID.parse('person', item.id)}`);
                }}
              />
            );

          case 'PlaceType':
            return (
              <PlaceCard
                key={item.id}
                place={item}
                onClick={() => {
                  navigate(`/places/${GlobalUID.parse('place', item.id)}`);
                }}
              />
            );

          case 'ThreadType':
            return (
              <ThreadCard
                key={item.id}
                thread={item}
                onClick={() => {
                  navigate(`/chat/${GlobalUID.parse('thread', item.id)}`);
                }}
              />
            );

          default:
            return null;
        }
      })}
    </SearchGrid>
  );
}
