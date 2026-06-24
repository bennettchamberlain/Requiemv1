import { Field, ObjectType } from '@nestjs/graphql';

import { CommunicationType } from './CommunicationType';
import { MutationPayload } from './MutationPayload';

@ObjectType()
export class CreateCommunicationPayload extends MutationPayload {
  @Field(() => CommunicationType, { nullable: true })
  communication?: CommunicationType;
}
