import { useEffect, useState } from 'react';
import { useQuery, useMutation, type Reference, isReference } from '@apollo/client';
import { Button, Dialog, Input, Label, Textarea } from '@ci/shadcn';

import { gql } from '@/graphql';
import { EntityTypeFilter } from '@/components/SearchBox/EntityTypeFilter';
import {DropdownProvider, useDropdown} from "@/components/SearchBox/useDropdown.ts";
import { ENTITY_TYPE_REVERSE_MAP } from '@ci/common/src/constants';
import {TagInput} from "@/components/TagInput";

interface Props {
  savedSearch: {
    id: string;
    name: string;
    description: string;
    query: string;
    entityTypes: string[];
    tags: string[];
  };
  onClose: () => void;
}

const UPDATE_SAVED_SEARCH = gql(`
  mutation UpdateSavedSearch($input: UpdateSavedSearchInput!) {
    updateSavedSearch(input: $input) {
      success
      savedSearch {
        id
        name
        description
        query
        entityTypes
        tags
      }
    }
  }
`);

export function EditSavedSearchModal({ savedSearch, onClose }: Props) {
  const [name, setName] = useState(savedSearch.name);
  const [description, setDescription] = useState(savedSearch.description);
  const [query, setQuery] = useState(savedSearch.query);
  const [entityTypes, setEntityTypes] = useState<string[]>(savedSearch.entityTypes);
  const [tags, setTags] = useState<string[]>(savedSearch.tags);
  const [{ selectedEntityTypes }, { setSelectedEntityTypes }] = useDropdown();

  useEffect(() => {
    const mappedEntityTypes = savedSearch.entityTypes
      .map((type) => ENTITY_TYPE_REVERSE_MAP[type as keyof typeof ENTITY_TYPE_REVERSE_MAP])
    setSelectedEntityTypes(mappedEntityTypes);
  }, [savedSearch?.entityTypes]);


  const [updateSavedSearch, { loading: updating }] = useMutation(UPDATE_SAVED_SEARCH, {
    update(cache, { data }) {
      const updatedSavedSearchId = data?.updateSavedSearch?.savedSearch.id;

      if (updatedSavedSearchId) {
        cache.modify({
          fields: {
            savedSearches(
              existingSavedSearches:
                | {
                    edges: { node: Reference }[];
                  }
                | Reference = { edges: [] },
              { readField },
            ) {
              if (isReference(existingSavedSearches)) {
                return existingSavedSearches;
              }

              return {
                ...existingSavedSearches,
                edges: existingSavedSearches.edges.map((edge) => {
                  const edgeNodeId = readField('id', edge.node);

                  return edgeNodeId !== updatedSavedSearchId ? edge : {
                    node: data.updateSavedSearch.savedSearch
                  };
                }),
              };
            },
          },
        });

        const normalizedId = cache.identify({
          id: updatedSavedSearchId,
          __typename: 'SavedSearchType',
        });

        if (normalizedId) {
          console.log('evicting', normalizedId)
          cache.evict({ id: normalizedId });
          cache.gc();
        }
      }
    },
  });

  const handleSave = async () => {
    await updateSavedSearch({
      variables: {
        input: {
          id: savedSearch.id,
          name,
          description,
          query,
          entityTypes,
          tags,
        },
      },
    });

    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content className="sm:max-w-[600px]">
        <Dialog.Header>
          <Dialog.Title>Update Saved Search</Dialog.Title>
        </Dialog.Header>

        <DropdownProvider args={[]}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter search name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter search description"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="query">Query</Label>
              <Input
                id="query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter search query"
              />
            </div>

            <div className="space-y-2">
              <Label>Entity Types</Label>
              <EntityTypeFilter />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <TagInput tags={savedSearch.tags} onTagAdded={() => true}/>
              <Input
                id="tags"
                value={tags.join(', ')}
                disabled
                placeholder="No tags"
              />
            </div>
          </div>
        </DropdownProvider>

        <Dialog.Footer>
          <Button variant="outline" onClick={onClose} disabled={updating}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={updating}>
            {updating ? 'Saving...' : 'Save'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
