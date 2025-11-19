import path from 'node:path';

import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';

import { ConversationModule } from '@ci/domains/conversations';
import { MemoryModule } from '@ci/domains/memory';
import { UserModule } from '@ci/domains/user';

import { GraphQLController } from './controllers/GraphQLController';
import { ThreadMessagesLoader } from './dataloaders/ThreadMessagesLoader';
import { PersonResolver } from './resolvers/PersonResolver';
import { SearchResolver } from './resolvers/SearchResolver';
import { ThreadResolver } from './resolvers/ThreadResolver';
import { UserResolver } from './resolvers/UserResolver';

@Module({
  imports: [
    NestGraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: path.join(__dirname, '__generated__/schema.graphql'),
      sortSchema: true,
      playground: false,
      introspection: true,
      graphiql: false,
    }),
    ConversationModule,
    MemoryModule,
    UserModule,
  ],
  providers: [PersonResolver, SearchResolver, ThreadMessagesLoader, ThreadResolver, UserResolver],
  controllers: [GraphQLController],
  exports: [],
})
export class GraphQLModule {}
