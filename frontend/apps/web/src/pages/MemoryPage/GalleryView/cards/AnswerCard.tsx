import { type MouseEvent } from 'react';

import { AnswerIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const ANSWER_FRAGMENT = gql(`
  fragment GalleryAnswerCardData on AnswerType {
    id
    answer
    question {
      id
      text
    }
  }
`);

interface Props {
  answer: FragmentType<typeof ANSWER_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function AnswerCard({ answer, onClick }: Props) {
  const data = useFragment(ANSWER_FRAGMENT, answer);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <AnswerIcon />

        <div className="text-md font-semibold truncate">Question</div>
      </SearchCard.Header>

      <SearchCard.Content className="overflow-hidden">
        <div className="shrink-0">
          <div className="line-clamp-2 leading-tight italic text-muted-foreground">{data.question.text}</div>
        </div>

        <div className="grow min-h-0 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-transparent to-card/90" />
          <div className="leading-tight text-foreground">{data.answer}</div>
        </div>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Question</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
