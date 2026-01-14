import { useMutation, type Reference, isReference } from '@apollo/client';
import { Button, Dialog } from '@ci/shadcn';

import { gql } from '@/graphql';

interface Props {
  savedSearch: object;
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

export function UpdateSavedSearchModal({ savedSearch, onClose }: Props) {
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
                edges: existingSavedSearches.edges.filter((edge) => {
                  const edgeNodeId = readField('id', edge.node);

                  return edgeNodeId !== updatedSavedSearchId;
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
          name: savedSearch.name,
          description: savedSearch.description,
          query: savedSearch.query,
          entityTypes: savedSearch.entityTypes,
          tags: savedSearch.tags,
        },
      },
    });

    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content className="sm:max-w-[425px]">
        <Dialog.Header>
          <Dialog.Title>Update Saved Search</Dialog.Title>
        </Dialog.Header>
        <Dialog.Title>
          {savedSearch.name || '<untitled>'}
        </Dialog.Title>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose} disabled={updating}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleSave} disabled={updating}>
            {updating ? 'Saving...' : 'Save'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
