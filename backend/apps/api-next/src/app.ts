import {
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import config from './config';
import { RequestContextMiddleware, RequestLoggerMiddleware } from './common/middleware';
import { AuthModule } from './domains/auth';
import { UserModule } from './domains/user';
import { EmbeddingModule } from './domains/search';
import { LoggerService } from './common/services';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: config.db.type,
      url: config.db.url,
      entities: [__dirname + '/domains/**/*Entity.{ts,js}'],
      logging: config.db.logging,
    }),
    AuthModule,
    UserModule,
    EmbeddingModule,
  ],
  controllers: [],
  providers: [],
})
export class App implements NestModule, OnApplicationBootstrap, OnApplicationShutdown {
  private logger = new LoggerService('application');

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }

  onApplicationBootstrap() {
    this.logger.log('Application listening', {
      host: config.host,
      port: config.port,
    });
  }

  onApplicationShutdown(signal?: string) {
    this.logger.log('Application stopped', {
      signal,
    });
  }
}
