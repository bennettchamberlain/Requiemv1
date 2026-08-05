import { Field, ObjectType } from '@nestjs/graphql';

import type { EntityIdentifierEntity } from '@ci/domains/graph';

/**
 * One contact method / identifier claimed by a person: the normalized value
 * used for matching, plus the raw form, label, and provenance from
 * ci.entity_identifiers.
 */
@ObjectType()
export class PersonIdentifierType {
  @Field(() => String)
  kind!: string;

  @Field(() => String)
  value!: string;

  @Field(() => String, { nullable: true })
  rawValue!: string | null;

  @Field(() => String, { nullable: true })
  label!: string | null;

  @Field(() => Boolean)
  isPrimary!: boolean;

  @Field(() => String, { nullable: true })
  source!: string | null;

  @Field(() => Date, { nullable: true })
  verifiedAt!: Date | null;

  static toType(row: EntityIdentifierEntity): PersonIdentifierType {
    return {
      kind: row.kind,
      value: row.valueNormalized,
      rawValue: row.rawValue ?? null,
      label: row.label ?? null,
      isPrimary: row.isPrimary ?? false,
      source: row.source ?? null,
      verifiedAt: row.verifiedAt ?? null,
    };
  }
}
