import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import path from 'node:path';

import { GraphQLController } from './controllers/GraphQLController';
import { RecipeResolver } from './resolvers/RecipeResolver';

@Module({
  imports: [
    NestGraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: path.join(__dirname, '__generated__/schema.graphql'),
      sortSchema: true,
      playground: false,
      graphiql: false,
    }),
  ],
  providers: [RecipeResolver],
  controllers: [GraphQLController],
  exports: [],
})
export class GraphQLModule {}
