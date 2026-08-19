import { Field, Int, ObjectType } from '@nestjs/graphql';

import { MergeCandidateType } from './MergeCandidateType';
import { PageInfo } from './PageInfo';

/**
 * Deliberately NOT the `Edge` interface: that interface's `node` is a `Node`
 * (a GlobalUID-addressable entity), and a merge candidate is a proposal ABOUT
 * two entities, not an entity itself.
 */
@ObjectType()
export class MergeCandidateEdge {
  @Field(() => String)
  cursor!: string;

  @Field(() => MergeCandidateType)
  node!: MergeCandidateType;
}

@ObjectType()
export class MergeCandidateConnection {
  @Field(() => [MergeCandidateEdge])
  edges!: MergeCandidateEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  /** Reviewable pairs in this status — the whole queue, not this page. */
  @Field(() => Int)
  totalCount!: number;
}
