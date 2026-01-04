import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';
import {
  MOCK_ANSWERS,
  MOCK_COMMUNICATIONS,
  MOCK_CONCEPTS,
  MOCK_CONTENT,
  MOCK_ITEMS,
  MOCK_EVENTS,
  MOCK_FILES,
  MOCK_PEOPLE,
  MOCK_PLACES,
  MOCK_THREADS,
} from '@/graphql/mocks';

import { AnswerCard, ANSWER_FRAGMENT } from './cards/AnswerCard';
import { CommunicationCard, COMMUNICATION_FRAGMENT } from './cards/CommunicationCard';
import { ConceptCard, CONCEPT_FRAGMENT } from './cards/ConceptCard';
import { ContentCard, CONTENT_FRAGMENT } from './cards/ContentCard';
import { EventCard, EVENT_FRAGMENT } from './cards/EventCard';
import { FileCard, FILE_FRAGMENT } from './cards/FileCard';
import { ItemCard, ITEM_FRAGMENT } from './cards/ItemCard';
import { PersonCard, PERSON_FRAGMENT } from './cards/PersonCard';
import { PlaceCard, PLACE_FRAGMENT } from './cards/PlaceCard';
import { ThreadCard, THREAD_FRAGMENT } from './cards/ThreadCard';
import { SearchGrid } from './SearchGrid';

const items: (
  | (typeof MOCK_PEOPLE)[number]
  | (typeof MOCK_PLACES)[number]
  | (typeof MOCK_EVENTS)[number]
  | (typeof MOCK_THREADS)[number]
  | (typeof MOCK_FILES)[number]
  | (typeof MOCK_COMMUNICATIONS)[number]
  | (typeof MOCK_ITEMS)[number]
  | (typeof MOCK_CONTENT)[number]
  | (typeof MOCK_ANSWERS)[number]
  | (typeof MOCK_CONCEPTS)[number]
)[] = [];

const maxLength = Math.max(
  MOCK_PEOPLE.length,
  MOCK_PLACES.length,
  MOCK_EVENTS.length,
  MOCK_THREADS.length,
  MOCK_FILES.length,
  MOCK_COMMUNICATIONS.length,
  MOCK_ITEMS.length,
  MOCK_CONTENT.length,
  MOCK_ANSWERS.length,
  MOCK_CONCEPTS.length,
);

for (let i = 0; i < maxLength; i++) {
  if (i < MOCK_PEOPLE.length) {
    items.push(MOCK_PEOPLE[i]);
  }

  if (i < MOCK_PLACES.length) {
    items.push(MOCK_PLACES[i]);
  }

  if (i < MOCK_EVENTS.length) {
    items.push(MOCK_EVENTS[i]);
  }

  if (i < MOCK_THREADS.length) {
    items.push(MOCK_THREADS[i]);
  }

  if (i < MOCK_FILES.length) {
    items.push(MOCK_FILES[i]);
  }

  if (i < MOCK_COMMUNICATIONS.length) {
    items.push(MOCK_COMMUNICATIONS[i]);
  }

  if (i < MOCK_ITEMS.length) {
    items.push(MOCK_ITEMS[i]);
  }

  if (i < MOCK_CONTENT.length) {
    items.push(MOCK_CONTENT[i]);
  }

  if (i < MOCK_ANSWERS.length) {
    items.push(MOCK_ANSWERS[i]);
  }

  if (i < MOCK_CONCEPTS.length) {
    items.push(MOCK_CONCEPTS[i]);
  }
}

const meta: Meta = {
  parameters: {
    layout: 'padded',
  },

  args: {
    onClick: fn(),
  },

  render: (args) => {
    return (
      <SearchGrid>
        {items.map((item) => {
          switch (item.__typename) {
            case 'PersonType':
              return (
                <PersonCard
                  key={item.id}
                  person={makeFragmentData(item, PERSON_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'PlaceType':
              return (
                <PlaceCard
                  key={item.id}
                  place={makeFragmentData(item, PLACE_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'EventType':
              return (
                <EventCard
                  key={item.id}
                  event={makeFragmentData(item, EVENT_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'ThreadType':
              return (
                <ThreadCard
                  key={item.id}
                  thread={makeFragmentData(item, THREAD_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'FileType':
              return (
                <FileCard
                  key={item.id}
                  file={makeFragmentData(item, FILE_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'CommunicationType':
              return (
                <CommunicationCard
                  key={item.id}
                  communication={makeFragmentData(item, COMMUNICATION_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'ItemType':
              return (
                <ItemCard
                  key={item.id}
                  item={makeFragmentData(item, ITEM_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'ContentType':
              return (
                <ContentCard
                  key={item.id}
                  content={makeFragmentData(item, CONTENT_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'AnswerType':
              return (
                <AnswerCard
                  key={item.id}
                  answer={makeFragmentData(item, ANSWER_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            case 'ConceptType':
              return (
                <ConceptCard
                  key={item.id}
                  concept={makeFragmentData(item, CONCEPT_FRAGMENT)}
                  onClick={() => args.onClick(item.id)}
                />
              );

            default:
              return null;
          }
        })}
      </SearchGrid>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
