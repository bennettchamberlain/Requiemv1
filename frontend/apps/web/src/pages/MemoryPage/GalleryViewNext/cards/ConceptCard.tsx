import { type MouseEvent } from 'react';

import { ConceptIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const CONCEPT_FRAGMENT = gql(`
  fragment GalleryConceptCardData on ConceptType {
    id
    name
    description
  }
`);

interface Props {
  concept: FragmentType<typeof CONCEPT_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function ConceptCard({ concept, onClick }: Props) {
  const data = useFragment(CONCEPT_FRAGMENT, concept);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <ConceptIcon />

        <div className="text-md font-semibold truncate">{data.name}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">{data.description}</div>
      </SearchCard.Content>

      <SearchCard.Footer>
        <div className="text-sm text-muted-foreground">Concept</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
