import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import config from './config';
import { RequestContextMiddleware, RequestLoggerMiddleware } from './common/middleware';
import { AuthModule } from './domains/auth';
import { UserModule } from './domains/user';
import { EmbeddingModule } from './domains/search';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: config.db.type,
      url: config.db.url,
      entities: [__dirname + '/domains/**/*Entity.{ts,js}'],
    }),
    AuthModule,
    UserModule,
    EmbeddingModule,
  ],
  controllers: [],
  providers: [],
})
export class App implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
