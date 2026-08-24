import { describe, expect, it } from 'vitest';

import type { MemoryEntity } from '@/pages/MemoryPage/useEntityService';

import { entityToAgentChatContext } from './entityToAgentChatContext';

function asEntity(entity: Record<string, unknown>): MemoryEntity {
  return entity as unknown as MemoryEntity;
}

describe('entityToAgentChatContext', () => {
  it('strips HTML from a note and uses the title', () => {
    expect(
      entityToAgentChatContext(
        asEntity({
          __typename: 'NoteType',
          id: 'n1',
          title: 'Picnic',
          content: '<p>Bring <b>snacks</b>.</p>',
        }),
      ),
    ).toEqual({
      title: 'Picnic',
      body: 'Bring snacks.',
      sourceKind: 'NoteType',
      sourceId: 'n1',
    });
  });

  it('uses an event display title and description', () => {
    const context = entityToAgentChatContext(
      asEntity({
        __typename: 'EventType',
        id: 'e1',
        title: 'Dinner with Sam',
        description: 'Tacos on the pier',
        startTime: '2026-06-17T19:00:00Z',
        locationName: 'Malibu',
      }),
    );

    expect(context.title).toBe('Dinner with Sam');
    expect(context.body).toBe('Tacos on the pier');
    expect(context.sourceKind).toBe('EventType');
    expect(context.sourceId).toBe('e1');
  });

  it('prefers communication subject and keeps the preview as the body', () => {
    expect(
      entityToAgentChatContext(
        asEntity({
          __typename: 'CommunicationType',
          id: 'c1',
          subject: 'Flights',
          preview: 'Land at 4pm',
        }),
      ),
    ).toEqual({
      title: 'Flights',
      body: 'Land at 4pm',
      sourceKind: 'CommunicationType',
      sourceId: 'c1',
    });
  });

  it('uses a file chunk section title and content', () => {
    const context = entityToAgentChatContext(
      asEntity({
        __typename: 'FileChunkType',
        id: 'fc1',
        sectionTitle: 'Warranty',
        chunkContent: 'Valid through 2027.',
        file: { filename: 'manual.pdf' },
      }),
    );

    expect(context.title).toBe('Warranty');
    expect(context.body).toBe('Valid through 2027.');
  });

  it('uses the question as the title of an answer', () => {
    expect(
      entityToAgentChatContext(
        asEntity({
          __typename: 'AnswerType',
          id: 'a1',
          answer: 'Blue',
          question: { text: 'Favorite color?' },
        }),
      ),
    ).toEqual({
      title: 'Favorite color?',
      body: 'Blue',
      sourceKind: 'AnswerType',
      sourceId: 'a1',
    });
  });

  it('falls back to a generic name and description', () => {
    expect(
      entityToAgentChatContext(
        asEntity({
          __typename: 'GenericEntity',
          id: 'g1',
          name: 'Home',
          entityType: 'place',
          description: 'The house on Oak',
        }),
      ),
    ).toEqual({
      title: 'Home',
      body: 'The house on Oak',
      sourceKind: 'GenericEntity',
      sourceId: 'g1',
    });
  });
});
