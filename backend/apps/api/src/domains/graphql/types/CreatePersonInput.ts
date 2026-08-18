import { Field, InputType } from '@nestjs/graphql';

import { PersonAddressInput } from './PersonAddressType';
import { PersonContactInput } from './PersonContactInput';

@InputType()
export class CreatePersonInput {
  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  // External provenance key for idempotent resolve-or-create from a capture
  // source (e.g. linkedTable='ci-import-tools:contact', linkedId='dana@x.com').
  // Re-sending the same (linkedTable, linkedId) returns the existing person.
  @Field({ nullable: true })
  linkedTable?: string;

  @Field({ nullable: true })
  linkedId?: string;

  // Structured person fields — stored as the established properties JSONB keys
  // (first_name, birth_date, avatar_url, ...) so imported and user-created
  // people share one vocabulary.
  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  middleName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  nickname?: string;

  @Field({ nullable: true })
  pronouns?: string;

  @Field({ nullable: true })
  gender?: string;

  /** ISO date (YYYY-MM-DD). */
  @Field({ nullable: true })
  birthDate?: string;

  @Field({ nullable: true })
  jobTitle?: string;

  @Field({ nullable: true })
  organization?: string;

  @Field({ nullable: true })
  department?: string;

  @Field({ nullable: true })
  website?: string;

  /**
   * Labelled addresses (home, work, ...). The primary one is also mirrored onto
   * the flat `streetAddress`/`city`/... keys, so sending both is redundant —
   * prefer this.
   */
  @Field(() => [PersonAddressInput], { nullable: true })
  addresses?: PersonAddressInput[];

  // Flat single-address fields. Predate `addresses`; still accepted so existing
  // capture sources keep working. Ignored when `addresses` is also sent.
  @Field({ nullable: true })
  streetAddress?: string;

  @Field({ nullable: true })
  streetAddress2?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  region?: string;

  @Field({ nullable: true })
  country?: string;

  @Field({ nullable: true })
  postalCode?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  /**
   * Labelled contact methods (work email, mobile phone, ...); registered as
   * identifiers with source='user'. The labelled form of `emails`/`phones` —
   * both are accepted and merged.
   */
  @Field(() => [PersonContactInput], { nullable: true })
  contacts?: PersonContactInput[];

  /** Initial contact emails; registered as identifiers (source='user'). */
  @Field(() => [String], { nullable: true })
  emails?: string[];

  /** Initial contact phone numbers; registered as identifiers (source='user'). */
  @Field(() => [String], { nullable: true })
  phones?: string[];
}
