import {
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import config from './config';
import { RequestContextMiddleware, RequestLoggerMiddleware } from '@ci/common/middleware';
import { LoggerService } from '@ci/common/services';
import { AuthModule } from '@ci/domains/auth';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { EmbeddingModule } from '@ci/domains/search';
import { UserModule } from '@ci/domains/user';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: config.db.type,
      url: config.db.url,
      entities: [__dirname + '/domains/**/*Entity.{ts,js}'],
      logging: config.db.logging,
    }),
    AuthModule,
    EmbeddingModule,
    IntelligenceModule,
    UserModule,
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
