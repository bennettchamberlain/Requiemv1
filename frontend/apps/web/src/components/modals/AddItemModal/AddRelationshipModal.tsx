import { useCallback, useState, useMemo, type FormEvent } from 'react';

import { useMutation } from '@apollo/client';
import { GlobalUID } from '@ci/common';
import { Button, Dialog, Input, Textarea, Label, Select } from '@ci/shadcn';
import { X } from '@ci/shadcn/icons';

import { CommunicationResult } from '@/components/modals/SearchModal/results/CommunicationResult.tsx';
import { ConceptResult } from '@/components/modals/SearchModal/results/ConceptResult.tsx';
import { ContentResult } from '@/components/modals/SearchModal/results/ContentResult.tsx';
import { EventResult } from '@/components/modals/SearchModal/results/EventResult.tsx';
import { ItemResult } from '@/components/modals/SearchModal/results/ItemResult.tsx';
import { NoteResult } from '@/components/modals/SearchModal/results/NoteResult.tsx';
import { PersonResult } from '@/components/modals/SearchModal/results/PersonResult.tsx';
import { PlaceResult } from '@/components/modals/SearchModal/results/PlaceResult.tsx';
import { ThreadResult } from '@/components/modals/SearchModal/results/ThreadResult.tsx';
import { useSearchService } from '@/components/modals/SearchModal/useSearchService.ts';
import { SearchBox } from '@/components/SearchBox';
import { gql } from '@/graphql';

const CREATE_RELATIONSHIP = gql(`
  mutation CreateRelationship($input: CreateRelationshipInput!) {
    createRelationship(input: $input) {
      success
      relationship {
        id
        fromNodeId
        toNodeId
        properties
        isBidirectional
        startDate
        endDate
      }
    }
  }
`);

interface Props {
  startId: string;
  allowedRelationshipTypes: {
    communication?: string[];
    concept?: string[];
    content?: string[];
    event?: string[];
    item?: string[];
    note?: string[];
    person?: string[];
    place?: string[];
    thread?: string[];
  };
  open?: boolean;
  onClose?: (open?: boolean) => void;
}

export function AddRelationshipModal({ startId, allowedRelationshipTypes, open, onClose }: Props) {
  const [query, setQuery] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<{
    id: string;
    parsedId: string;
    type: string;
  } | null>(null);
  const [selectedRelationshipType, setSelectedRelationshipType] = useState<string>('');

  const { data, loading, error } = useSearchService({
    searchQuery: query ?? '',
  });

  const results = useMemo(
    () =>
      data.map((item) => {
        switch (item.__typename) {
          case 'CommunicationType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('communication', item.id),
              type: 'communication',
              content: <CommunicationResult communication={item} />,
            };

          case 'ConceptType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('concept', item.id),
              type: 'concept',
              content: <ConceptResult concept={item} />,
            };

          case 'ContentType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('content', item.id),
              type: 'content',
              content: <ContentResult content={item} />,
            };

          case 'EventType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('event', item.id),
              type: 'event',
              content: <EventResult event={item} />,
            };

          case 'ItemType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('item', item.id),
              type: 'item',
              content: <ItemResult item={item} />,
            };

          case 'NoteType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('note', item.id),
              type: 'note',
              content: <NoteResult note={item} />,
            };

          case 'PersonType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('person', item.id),
              type: 'person',
              content: <PersonResult person={item} />,
            };

          case 'PlaceType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('place', item.id),
              type: 'place',
              content: <PlaceResult place={item} />,
            };

          case 'ThreadType':
            return {
              id: item.id,
              parsedId: GlobalUID.parse('thread', item.id),
              type: 'thread',
              content: <ThreadResult thread={item} />,
            };

          default:
            return {
              id: item.id,
              parsedId: item.id,
              type: 'unknown',
              content: null,
            };
        }
      }),
    [data],
  );

  const [createRelationship] = useMutation(CREATE_RELATIONSHIP);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      await createRelationship({
        variables: {
          input: {
            fromEntityId: '',
            toEntityId: '',
            type: '',
          },
        },
      });

      // Reset form and close modal on success
      setSelectedEntity(null);
      setSelectedRelationshipType(null);
      setQuery(null);
      onClose?.(false);
    } catch (error) {
      console.error('Failed to create person:', error);
    }
  };

  const handleCancel = () => {
    onClose?.(false);
  };

  const handleCreate = async () => {
    if (!selectedEntity || !selectedRelationshipType) {
      return;
    }

    try {
      await createRelationship({
        variables: {
          input: {
            fromNodeId: startId,
            toNodeId: selectedEntity.parsedId,
            type: selectedRelationshipType,
          },
        },
      });

      // Reset form and close modal on success
      setSelectedEntity(null);
      setSelectedRelationshipType(null);
      setQuery(null);
      onClose?.(false);
    } catch (error) {
      console.error('Failed to create relationship:', error);
    }
  };

  const handleClose = () => {
    setSelectedEntity(null);
    setSelectedRelationshipType(null);
    setQuery(null);
    onClose?.(false);
  };

  const handleSearch = useCallback(({ query: searchQuery }: { query: string }) => {
    setQuery(searchQuery);
  }, []);

  const handleResultSelect = (e: FormEvent<HTMLSelectElement>) => {
    const { content, ...rest } = e;
    setSelectedEntity(rest);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <Dialog.Content className="sm:max-w-md">
        <Dialog.Header>
          <Dialog.Title className="text-xl mb-4">Add Relationship</Dialog.Title>
        </Dialog.Header>

        <Dialog.Title>Related Entity</Dialog.Title>
        {!selectedEntity && (
          <SearchBox
            onSearch={handleSearch}
            onResultSelect={handleResultSelect}
            onKeyDown={() => {}}
            variant="compact"
            autoSubmit
            displayResults
            loading={loading}
            error={error}
            results={results}
          />
        )}
        {selectedEntity && (
          <div className="flex items-center gap-2">
            <div className="flex-1">{results.find((r) => r.id === selectedEntity.id)?.content}</div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedEntity(null);
                setSelectedRelationshipType(null);
              }}
              className="text-gray-500 hover:text-red-400 hover:bg-red-50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {selectedEntity && (
          <div className="mt-4">
            <Label htmlFor="relationship-type">Relationship Type</Label>
            <Select value={selectedRelationshipType} onValueChange={setSelectedRelationshipType}>
              <Select.Trigger id="relationship-type">
                <Select.Value placeholder="Select relationship type" />
              </Select.Trigger>
              <Select.Content>
                {(
                  allowedRelationshipTypes[selectedEntity.type as keyof typeof allowedRelationshipTypes] || []
                )
                  .sort((a, b) => a.localeCompare(b))
                  .map((type) => {
                    const formattedType = type
                      .replace(/_/g, ' ')
                      .toLowerCase()
                      .replace(/^\w/, (c) => c.toUpperCase());

                    return (
                      <Select.Item key={type} value={type}>
                        {formattedType}
                      </Select.Item>
                    );
                  })}
              </Select.Content>
            </Select>
          </div>
        )}

        <Dialog.Footer className="flex gap-2 justify-end">
          <Button type="button" variant="destructive" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            disabled={!selectedEntity || !selectedRelationshipType}
            onClick={handleCreate}
            className="bg-green-600 hover:bg-green-700"
          >
            Add
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
