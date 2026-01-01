import { Images } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { makeFragmentData } from '@/graphql';
import { Empty } from '@/pages/MemoryPage/Components';
import { ANSWER_FRAGMENT, AnswerCard } from '@/pages/MemoryPage/GalleryViewNext/cards/AnswerCard';
import {
  COMMUNICATION_FRAGMENT,
  CommunicationCard,
} from '@/pages/MemoryPage/GalleryViewNext/cards/CommunicationCard';
import { CONTENT_FRAGMENT, ContentCard } from '@/pages/MemoryPage/GalleryViewNext/cards/ContentCard';
import { EVENT_FRAGMENT, EventCard } from '@/pages/MemoryPage/GalleryViewNext/cards/EventCard';
import { FILE_FRAGMENT, FileCard } from '@/pages/MemoryPage/GalleryViewNext/cards/FileCard';
import { ITEM_FRAGMENT, ItemCard } from '@/pages/MemoryPage/GalleryViewNext/cards/ItemCard';
import { PERSON_FRAGMENT, PersonCard } from '@/pages/MemoryPage/GalleryViewNext/cards/PersonCard';
import { PLACE_FRAGMENT, PlaceCard } from '@/pages/MemoryPage/GalleryViewNext/cards/PlaceCard';
import { THREAD_FRAGMENT, ThreadCard } from '@/pages/MemoryPage/GalleryViewNext/cards/ThreadCard';

import { useMemoryServiceNext } from '../useMemoryServiceNext';

import { SearchGrid } from './SearchGrid';

export function GalleryViewNext() {
  const [searchParams] = useSearchParams();
  const { data } = useMemoryServiceNext({
    searchQuery: searchParams.get('search') || '',
    excludeTypes: searchParams.get('excludedEntityTypes')?.split(',') || [],
  });

  return (
    <>
      {data.length === 0 ? (
        <Empty
          title="No results found"
          description="Connect your data sources or try a different search to see content here"
          icon={Images}
        />
      ) : (
        <SearchGrid>
          {data.map((item) => {
            switch (item.__typename) {
              case 'PersonType':
                return (
                  <PersonCard
                    key={item.id}
                    person={makeFragmentData(item, PERSON_FRAGMENT)}
                    onClick={() => {}}
                  />
                );

              case 'PlaceType':
                return (
                  <PlaceCard
                    key={item.id}
                    place={makeFragmentData(item, PLACE_FRAGMENT)}
                    onClick={() => {}}
                  />
                );

              case 'EventType':
                return (
                  <EventCard
                    key={item.id}
                    event={makeFragmentData(item, EVENT_FRAGMENT)}
                    onClick={() => {}}
                  />
                );

              case 'ThreadType':
                return (
                  <ThreadCard
                    key={item.id}
                    thread={makeFragmentData(item, THREAD_FRAGMENT)}
                    onClick={() => {}}
                  />
                );

              case 'FileType':
                return (
                  <FileCard key={item.id} file={makeFragmentData(item, FILE_FRAGMENT)} onClick={() => {}} />
                );

              case 'CommunicationType':
                return (
                  <CommunicationCard
                    key={item.id}
                    communication={makeFragmentData(item, COMMUNICATION_FRAGMENT)}
                    onClick={() => {}}
                  />
                );

              case 'ItemType':
                return (
                  <ItemCard key={item.id} item={makeFragmentData(item, ITEM_FRAGMENT)} onClick={() => {}} />
                );

              case 'ContentType':
                return (
                  <ContentCard
                    key={item.id}
                    content={makeFragmentData(item, CONTENT_FRAGMENT)}
                    onClick={() => {}}
                  />
                );

              case 'AnswerType':
                return (
                  <AnswerCard
                    key={item.id}
                    answer={makeFragmentData(item, ANSWER_FRAGMENT)}
                    onClick={() => {}}
                  />
                );

              default:
                return null;
            }
          })}
        </SearchGrid>
      )}
    </>
  );
}
