import { Field, ID, ObjectType } from '@nestjs/graphql';

import { PersonEntity } from '@ci/domains/memory';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';

@ObjectType({ implements: () => [Node] })
export class PersonType implements Node {
  __typename = PersonType.name;

  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => String, { nullable: true })
  firstName!: string | null;

  @Field(() => String, { nullable: true })
  lastName!: string | null;

  @Field(() => String, { nullable: true })
  gender!: string | null;

  @Field(() => String, { nullable: true })
  address!: string | null;

  @Field(() => String, { nullable: true })
  streetAddress!: string | null;

  @Field(() => String, { nullable: true })
  streetAddress2!: string | null;

  @Field(() => String, { nullable: true })
  city!: string | null;

  @Field(() => String, { nullable: true })
  region!: string | null;

  @Field(() => String, { nullable: true })
  country!: string | null;

  @Field(() => String, { nullable: true })
  postalCode!: string | null;

  @Field(() => String, { nullable: true })
  avatarUrl!: string | null;

  static fromEntity(person: PersonEntity): PersonType {
    return {
      __typename: PersonType.name,
      id: GlobalUID.encode('person', person.id),
      name: person.name,
      description: person.description,
      firstName: person.first_name,
      lastName: person.last_name,
      gender: person.gender,
      address: person.address,
      streetAddress: person.street_address,
      streetAddress2: person.street_address_2,
      city: person.city,
      region: person.region,
      country: person.country,
      postalCode: person.postal_code,
      avatarUrl: person.avatar_url,
    };
  }
}
