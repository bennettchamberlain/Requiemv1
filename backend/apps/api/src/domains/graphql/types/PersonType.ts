import { Field, ID, ObjectType } from '@nestjs/graphql';

import { PersonEntity } from '@ci/domains/memory';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';

@ObjectType({ implements: () => [Node] })
export class PersonType implements Node {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => String, { nullable: true })
  type!: string | null;

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

  @Field(() => String, { nullable: true })
  externalId!: string | null;

  @Field(() => String, { nullable: true })
  sourceUrl!: string | null;

  static fromEntity(entity: PersonEntity): PersonType {
    const person = new this();

    person.id = GlobalUID.toGUID('person', entity.id);
    person.name = entity.name;
    person.description = entity.description;
    person.type = entity.type;
    person.firstName = entity.first_name;
    person.lastName = entity.last_name;
    person.gender = entity.gender;
    person.address = entity.address;
    person.streetAddress = entity.street_address;
    person.streetAddress2 = entity.street_address_2;
    person.city = entity.city;
    person.region = entity.region;
    person.country = entity.country;
    person.postalCode = entity.postal_code;
    person.avatarUrl = entity.avatar_url;
    person.externalId = entity.external_id;
    person.sourceUrl = entity.source_url;

    return person;
  }
}
