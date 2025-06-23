import { Injectable } from '@nestjs/common';
import { Query, Resolver, Args } from '@nestjs/graphql';
import { v4 as uuidv4 } from 'uuid';

import { RecipeType } from '../types/RecipeType';

@Injectable()
@Resolver(() => RecipeType)
export class RecipeResolver {
  private recipes: RecipeType[] = [
    {
      id: uuidv4(),
      title: 'Chocolate Cake',
      description: 'Rich and delicious chocolate cake.',
      creationDate: new Date('2024-01-01'),
      ingredients: ['flour', 'sugar', 'cocoa powder', 'eggs'],
    },
    {
      id: uuidv4(),
      title: 'Tomato Soup',
      description: 'Simple and comforting.',
      creationDate: new Date('2024-02-10'),
      ingredients: ['tomatoes', 'onion', 'garlic'],
    },
  ];

  @Query(() => [RecipeType], { name: 'getRecipes' })
  getRecipes(): RecipeType[] {
    return this.recipes;
  }

  @Query(() => RecipeType, { name: 'getRecipe', nullable: true })
  getRecipe(@Args('id', { type: () => String }) id: string): RecipeType | undefined {
    return this.recipes.find((r) => r.id === id);
  }
}
