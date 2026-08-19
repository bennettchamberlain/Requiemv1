import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateTagInput {
  @Field(() => ID)
  id!: string;

  /** Omit to leave the label alone. Labels are normalised to lower case. */
  @Field(() => String, { nullable: true })
  label?: string;

  /** Omit to leave the description alone; pass null to clear it. */
  @Field(() => String, { nullable: true })
  description?: string | null;
}
