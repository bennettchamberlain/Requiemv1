import { Field, ID, InputType, Int } from '@nestjs/graphql';
import GraphQLJSONObject from 'graphql-type-json';

@InputType()
export class CreateCommunicationInput {
  @Field(() => Date)
  time!: Date;

  // communication_type enum value: 'email' | 'sms' | 'call' | 'chat' | ...
  @Field(() => String)
  communicationType!: string;

  // communication_direction enum value: 'inbound' | 'outbound' | ...
  @Field(() => String)
  direction!: string;

  @Field(() => String)
  content!: string;

  @Field(() => String, { nullable: true })
  subject?: string;

  @Field(() => String, { nullable: true })
  threadId?: string;

  @Field(() => Int, { nullable: true })
  durationSeconds?: number;

  @Field(() => GraphQLJSONObject, { nullable: true })
  participantsMetadata?: Record<string, unknown>;

  // Provenance triple — folded onto the row and used to derive a stable id for
  // idempotent re-sync (see CommunicationService.create).
  @Field(() => String, { nullable: true })
  sourceType?: string;

  @Field(() => String, { nullable: true })
  sourceSystem?: string;

  @Field(() => ID, { nullable: true })
  sourceId?: string;
}
