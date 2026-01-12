import { type MouseEvent } from 'react';

import DOMPurify from 'dompurify';
import parse from 'html-react-parser';

import { NoteIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const NOTE_FRAGMENT = gql(`
  fragment GalleryNoteCardData on NoteType {
    id
    title
    content
  }
`);

interface Props {
  note: FragmentType<typeof NOTE_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function NoteCard({ note, onClick }: Props) {
  const data = useFragment(NOTE_FRAGMENT, note);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <NoteIcon />

        <div className="text-md font-semibold truncate">{data.title}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">
          {data.content ? parse(DOMPurify.sanitize(data.content)) : null}
        </div>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Note</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
