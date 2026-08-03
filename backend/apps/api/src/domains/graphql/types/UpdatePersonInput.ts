import { Field, InputType } from '@nestjs/graphql';

/**
 * Partial update: only provided fields change. Structured fields patch the
 * matching properties JSONB keys (first_name, birth_date, ...); an explicit
 * empty string clears a property.
 */
@InputType()
export class UpdatePersonInput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

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
}
