import { Field, InputType } from '@nestjs/graphql';

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
  gender?: string;

  /** ISO date (YYYY-MM-DD). */
  @Field({ nullable: true })
  birthDate?: string;

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

  /** Initial contact emails; registered as identifiers (source='user'). */
  @Field(() => [String], { nullable: true })
  emails?: string[];

  /** Initial contact phone numbers; registered as identifiers (source='user'). */
  @Field(() => [String], { nullable: true })
  phones?: string[];
}
