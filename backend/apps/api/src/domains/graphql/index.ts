import path from 'node:path';

import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';

import { ConversationModule } from '@ci/domains/conversations';

import { GraphQLController } from './controllers/GraphQLController';

@Module({
  imports: [
    NestGraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: path.join(__dirname, '__generated__/schema.graphql'),
      sortSchema: true,
      playground: false,
      graphiql: false,
    }),
    ConversationModule,
  ],
  providers: [],
  controllers: [GraphQLController],
  exports: [],
})
export class GraphQLModule {}
