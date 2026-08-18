import { Field, ID, Int, ObjectType, Float, registerEnumType } from '@nestjs/graphql';
import GraphQLJSONObject from 'graphql-type-json';

import { type Item } from '@ci/domains/memory';

import { EntityTagType } from './EntityTagType';
import { FileType } from './FileType';
import { GlobalUID } from './GlobalUID';
import { Node } from './Node';
import { ItemAcquisitionMethod, ItemUnitSystem } from './PhysicalItemProperties';
import { Taggable } from './Taggable';

export enum ItemCondition {
  NEW = 'new',
  LIKE_NEW = 'like_new',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  BROKEN = 'broken',
  NA = 'n/a',
}

registerEnumType(ItemCondition, {
  name: 'ItemCondition',
});

@ObjectType({ implements: () => [Node, Taggable] })
export class ItemType implements Node, Taggable {
  __typename = ItemType.name;

  __source!: Item;

  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => String, { nullable: true })
  category!: string | null;

  @Field(() => String, { nullable: true })
  subcategory!: string | null;

  @Field(() => String, { nullable: true })
  brand!: string | null;

  @Field(() => String, { nullable: true })
  model!: string | null;

  @Field(() => Float, { nullable: true })
  currentValue!: number | null;

  @Field(() => Float, { nullable: true })
  purchasePrice!: number | null;

  @Field(() => String)
  currency!: string;

  @Field(() => Date, { nullable: true, description: 'When it was bought or received.' })
  acquiredAt!: Date | null;

  @Field(() => ItemCondition, { nullable: true })
  condition!: string | null;

  @Field(() => Int)
  quantity!: number;

  // --- Physical properties -------------------------------------------------
  // Canonical SI, always: a client renders these in whatever units it likes but
  // never has to guess which ones it was given.

  @Field(() => Float, { nullable: true, description: 'Longest dimension, in millimetres.' })
  lengthMm!: number | null;

  @Field(() => Float, { nullable: true, description: 'Width, in millimetres.' })
  widthMm!: number | null;

  @Field(() => Float, { nullable: true, description: 'Height, in millimetres.' })
  heightMm!: number | null;

  @Field(() => Float, { nullable: true, description: 'As-owned mass, in grams.' })
  massG!: number | null;

  @Field(() => Float, { nullable: true, description: 'Capacity — what it holds — in millilitres.' })
  volumeMl!: number | null;

  @Field(() => ItemUnitSystem, {
    nullable: true,
    description: 'The unit system these measurements were entered in. Presentation only.',
  })
  unitSystem!: ItemUnitSystem | null;

  @Field(() => [String], { nullable: true, description: 'Colour names, dominant first.' })
  colors!: string[] | null;

  @Field(() => String, { nullable: true, description: 'Dominant colour as #rrggbb.' })
  colorHex!: string | null;

  @Field(() => [String], { nullable: true, description: 'What the object is made of.' })
  materials!: string[] | null;

  @Field(() => GraphQLJSONObject, {
    description: '{material: fraction}; {} when the proportions are unknown.',
  })
  composition!: Record<string, number>;

  @Field(() => ItemAcquisitionMethod, { nullable: true })
  acquisitionMethod!: ItemAcquisitionMethod | null;

  @Field(() => String, { nullable: true, description: 'Seller, giver or source.' })
  acquiredFrom!: string | null;

  @Field(() => Date, { nullable: true, description: 'When the object was made.' })
  manufacturedAt!: Date | null;

  @Field(() => Date, { nullable: true, description: 'When it stops being usable.' })
  expiresAt!: Date | null;

  @Field(() => Boolean)
  isDigital!: boolean;

  @Field(() => GraphQLJSONObject, { nullable: true })
  metadata?: Record<string, unknown> | null;

  @Field(() => FileType, { nullable: true, complexity: 5 })
  file?: FileType | null;

  @Field(() => [EntityTagType])
  tags!: EntityTagType[];

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  static toType(item: Item): ItemType {
    return {
      __typename: ItemType.name,
      __source: item,
      id: GlobalUID.encode('item', item.id),
      name: item.name,
      description: item.description,
      category: item.category,
      subcategory: item.subcategory,
      brand: item.brand,
      model: item.model,
      currentValue: item.currentValue,
      purchasePrice: item.purchasePrice,
      currency: item.currency,
      condition: item.condition,
      quantity: item.quantity,
      metadata: item.metadata,
      acquiredAt: item.acquiredAt,

      lengthMm: item.lengthMm,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      massG: item.massG,
      volumeMl: item.volumeMl,
      unitSystem: item.unitSystem,
      colors: item.colors,
      colorHex: item.colorHex,
      materials: item.materials,
      composition: item.composition ?? {},
      acquisitionMethod: item.acquisitionMethod,
      acquiredFrom: item.acquiredFrom,
      manufacturedAt: item.manufacturedAt,
      expiresAt: item.expiresAt,
      isDigital: item.isDigital,

      tags: [], // Hydrated by resolver
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
