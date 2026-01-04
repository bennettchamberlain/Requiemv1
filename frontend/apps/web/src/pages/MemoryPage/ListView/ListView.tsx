import { Images } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { Empty } from '@/pages/MemoryPage/Components';

import { useMemoryServiceNext } from '../useMemoryServiceNext';

import { AnswerRow } from './rows/AnswerRow';
import { BrowserActivityRow } from './rows/BrowserActivityRow';
import { CommunicationRow } from './rows/CommunicationRow';
import { ConceptRow } from './rows/ConceptRow';
import { ContentRow } from './rows/ContentRow';
import { EventRow } from './rows/EventRow';
import { FileRow } from './rows/FileRow';
import { ItemRow } from './rows/ItemRow';
import { PersonRow } from './rows/PersonRow';
import { PlaceRow } from './rows/PlaceRow';
import { ThreadRow } from './rows/ThreadRow';
import { SearchTable } from './SearchTable';

export function ListView() {
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
    <SearchTable className="p-4 pt-0">
      <SearchTable.RowGroup>
        {data.map((item) => {
          switch (item.__typename) {
            case 'PersonType':
              return <PersonRow key={item.id} person={item} onClick={() => {}} />;

            case 'PlaceType':
              return <PlaceRow key={item.id} place={item} onClick={() => {}} />;

            case 'EventType':
              return <EventRow key={item.id} event={item} onClick={() => {}} />;

            case 'ThreadType':
              return <ThreadRow key={item.id} thread={item} onClick={() => {}} />;

            case 'FileType':
              return <FileRow key={item.id} file={item} onClick={() => {}} />;

            case 'CommunicationType':
              return <CommunicationRow key={item.id} communication={item} onClick={() => {}} />;

            case 'ItemType':
              return <ItemRow key={item.id} item={item} onClick={() => {}} />;

            case 'ContentType':
              return <ContentRow key={item.id} content={item} onClick={() => {}} />;

            case 'AnswerType':
              return <AnswerRow key={item.id} answer={item} onClick={() => {}} />;

            case 'ConceptType':
              return <ConceptRow key={item.id} concept={item} onClick={() => {}} />;

            case 'BrowserActivityType':
              return <BrowserActivityRow key={item.id} browserActivity={item} onClick={() => {}} />;

            default:
              return null;
          }
        })}
      </SearchTable.RowGroup>
    </SearchTable>
  );
}
