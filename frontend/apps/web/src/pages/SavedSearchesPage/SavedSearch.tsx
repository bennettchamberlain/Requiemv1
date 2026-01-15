import { Button } from '@ci/shadcn';
import { Trash } from '@ci/shadcn/icons';
import DOMPurify from 'dompurify';
import parse from 'html-react-parser';

import { gql } from '@/graphql';
import { type FragmentType, useFragment } from '@/graphql/fragment-masking';

interface Props {
  savedSearch: FragmentType<typeof SavedSearchGridItemFragment>;
  openSavedSearchModal: (id: string) => void;
  onDelete: (e: React.MouseEvent) => void;
}

const SavedSearchGridItemFragment = gql(`
  fragment SavedSearchGridItemFragment on SavedSearchType {
    id
    name
    description
    query
    entityTypes
    tags
  }
`);

export function SavedSearch({ savedSearch: savedSearchMasked, openSavedSearchModal, onDelete }: Props) {
  const savedSearch = useFragment(SavedSearchGridItemFragment, savedSearchMasked);

  return (
    <div onClick={() => openSavedSearchModal(savedSearch.id)} key={savedSearch.id}>
      <div className="h-full w-full flex flex-col border border-border bg-card text-card-foreground shadow-md rounded-lg cursor-pointer select-none p-3 gap-3 hover:shadow-lg transition-shadow duration-75">
        <div className="flex items-center gap-2">
          <div className="text-md font-semibold truncate">{savedSearch.name ?? 'Untitled Saved Search'}</div>
        </div>
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          <div className="line-clamp-3 leading-tight">
            {savedSearch.description ? parse(DOMPurify.sanitize(savedSearch.description)) : null}
          </div>
        </div>
        <div className="flex items-center justify-end">
          <Button onClick={onDelete} size="icon" variant="ghost" aria-label="Delete Saved Search">
            <Trash className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
