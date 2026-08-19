import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

import type { MergeCandidate, MergeCandidateEvidence } from '@ci/domains/memory';

import { PersonType } from './PersonType';

/** One shared claim that justified a proposed pair. */
@ObjectType()
export class MergeCandidateEvidenceType {
  /** What matched: email | phone | name | … (detector-defined). */
  @Field(() => String)
  kind!: string;

  /** The normalized value both sides asserted. */
  @Field(() => String)
  value!: string;

  /** This claim's own strength, when the detector recorded one. */
  @Field(() => Float, { nullable: true })
  score!: number | null;

  static toType(evidence: MergeCandidateEvidence): MergeCandidateEvidenceType {
    return {
      kind: evidence.kind,
      value: evidence.value,
      score: evidence.score,
    };
  }
}

/**
 * A scored duplicate pair proposed by the `clean.duplicate_detect` pipeline
 * stage and awaiting a human decision — the contents of `ci.merge_candidates`.
 *
 * Distinct from `PersonDuplicateGroupType`, which is recomputed from exact
 * email/phone/name matches on every request and carries neither a score nor
 * the evidence behind it.
 */
@ObjectType()
export class MergeCandidateType {
  /** The `ci.merge_candidates` row id — NOT a GlobalUID. */
  @Field(() => ID)
  id!: string;

  /** The kind of entity the pair is about (`Person` today). */
  @Field(() => String)
  entityType!: string;

  /** Detector confidence in (0, 1]. */
  @Field(() => Float)
  score!: number;

  /** pending | accepted | rejected. */
  @Field(() => String)
  status!: string;

  /** Which detector generation proposed it. */
  @Field(() => String)
  detectedBy!: string;

  @Field(() => Int)
  detectorVersion!: number;

  @Field(() => Date)
  createdAt!: Date;

  /** Why the detector thinks these are the same, strongest first. */
  @Field(() => [MergeCandidateEvidenceType])
  evidence!: MergeCandidateEvidenceType[];

  /** Exactly two people — the pair under review. */
  @Field(() => [PersonType])
  people!: PersonType[];

  static toType(candidate: MergeCandidate): MergeCandidateType {
    return {
      id: candidate.id,
      entityType: candidate.entityType,
      score: candidate.score,
      status: candidate.status,
      detectedBy: candidate.detectedBy,
      detectorVersion: candidate.detectorVersion,
      createdAt: candidate.createdAt,
      evidence: candidate.evidence.map((item) => MergeCandidateEvidenceType.toType(item)),
      people: candidate.people.map((person) => PersonType.toType(person)),
    };
  }
}
