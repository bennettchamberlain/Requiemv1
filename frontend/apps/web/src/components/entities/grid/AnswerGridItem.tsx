import { type MouseEvent } from 'react';

import { AnswerProvenance } from '@/components/AnswerProvenance';
import { AnswerIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { EntityGridItem } from './EntityGridItem';

export const ANSWER_FRAGMENT = gql(`
  fragment AnswerGridItemData on AnswerType {
    id
    answer
    answerSource
    answerConfidence
    answerRationale
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

export function AnswerGridItem({ answer, onClick }: Props) {
  const data = useFragment(ANSWER_FRAGMENT, answer);

  return (
    <EntityGridItem onClick={onClick}>
      <EntityGridItem.Header>
        <AnswerIcon className="shrink-0" />

        <div className="text-md font-semibold truncate">Question</div>
      </EntityGridItem.Header>

      <EntityGridItem.Content className="overflow-hidden">
        <div className="shrink-0">
          <div className="line-clamp-2 leading-tight italic text-muted-foreground">{data.question.text}</div>
        </div>

        <div className="grow min-h-0 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-transparent to-card/90" />
          <div className="leading-tight text-foreground">{data.answer}</div>
        </div>
      </EntityGridItem.Content>

      <EntityGridItem.Footer className="self-end flex items-center gap-2">
        <div className="text-sm text-muted-foreground">Question</div>
        <AnswerProvenance
          source={data.answerSource}
          confidence={data.answerConfidence}
          rationale={data.answerRationale}
        />
      </EntityGridItem.Footer>
    </EntityGridItem>
  );
}
