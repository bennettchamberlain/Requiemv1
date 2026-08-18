import { Field, InputType, ObjectType } from '@nestjs/graphql';

import { type PersonAddress, formatPersonAddress } from '@ci/domains/memory';

/**
 * One labelled postal address on a person ('home', 'work', ...). People carry a
 * list rather than a single address; the primary one is also mirrored onto the
 * flat `streetAddress`/`city`/... fields of {@link PersonType} for readers that
 * predate the list.
 */
@ObjectType()
export class PersonAddressType {
  @Field(() => String, { nullable: true })
  label!: string | null;

  @Field(() => String, { nullable: true })
  streetAddress!: string | null;

  @Field(() => String, { nullable: true })
  streetAddress2!: string | null;

  @Field(() => String, { nullable: true })
  city!: string | null;

  @Field(() => String, { nullable: true })
  region!: string | null;

  @Field(() => String, { nullable: true })
  postalCode!: string | null;

  @Field(() => String, { nullable: true })
  country!: string | null;

  @Field(() => Boolean)
  isPrimary!: boolean;

  /** The whole address as one comma-joined line, ready to render. */
  @Field(() => String, { nullable: true })
  formatted!: string | null;

  static toType(address: PersonAddress): PersonAddressType {
    return {
      label: address.label,
      streetAddress: address.streetAddress,
      streetAddress2: address.streetAddress2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
      isPrimary: address.isPrimary,
      formatted: formatPersonAddress(address),
    };
  }
}

/**
 * An address in a create/update payload. Sending `addresses` REPLACES the whole
 * list — the person form edits it as one unit, and a partial merge would leave
 * no way to delete an address.
 */
@InputType()
export class PersonAddressInput {
  @Field({ nullable: true })
  label?: string;

  @Field({ nullable: true })
  streetAddress?: string;

  @Field({ nullable: true })
  streetAddress2?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  region?: string;

  @Field({ nullable: true })
  postalCode?: string;

  @Field({ nullable: true })
  country?: string;

  @Field({ nullable: true })
  isPrimary?: boolean;
}
