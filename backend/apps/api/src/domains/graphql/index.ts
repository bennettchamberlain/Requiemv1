import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import path from 'node:path';

import { LLMModule } from '@ci/domains/llm';

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
    LLMModule,
  ],
  providers: [],
  controllers: [GraphQLController],
  exports: [],
})
export class GraphQLModule {}
