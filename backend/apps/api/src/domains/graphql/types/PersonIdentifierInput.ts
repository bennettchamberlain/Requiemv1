import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class AddPersonIdentifierInput {
  @Field(() => ID)
  personId!: string;

  /** email | phone | name. */
  @Field()
  kind!: string;

  /** Raw value; normalized server-side with the shared identifier rule. */
  @Field()
  value!: string;

  @Field({ nullable: true })
  label?: string;
}

@InputType()
export class RemovePersonIdentifierInput {
  @Field(() => ID)
  personId!: string;

  @Field()
  kind!: string;

  @Field()
  value!: string;
}
