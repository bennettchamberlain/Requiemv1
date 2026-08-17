import { Global, Module, UnauthorizedException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

import { ContextService } from '@ci/common/context';
import { IdFormatGuard, JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggingModule } from '@ci/common/logging';
import { EventService } from '@ci/domains/events';

import { FilesModule } from '..';
import { FileService } from '../services/FileService';

const mockCanActivate = jest.fn();

class MockJwtAuthGuard {
  canActivate = mockCanActivate;
}

/**
 * These routes are asserted at the HTTP layer only — status codes, and that the
 * upload route's 50mb body limit beats the global 100kb one — so nothing here
 * needs a database. The module graph does, though: FilesModule and the
 * EventsModule it imports register entities with `TypeOrmModule.forFeature`,
 * and every repository provider those calls generate injects the DataSource.
 *
 * This suite used to satisfy that by listing the repository tokens and stubbing
 * each one, which made the list rot silently — adding `JobMetricEntity` to the
 * events domain left its repository resolving against a DataSource nothing
 * provides, and these five file-routing tests failed with a DI error naming a
 * domain they do not touch. One stub DataSource covers every entity in the
 * graph, present and future, because `createTypeOrmProviders` reads only these
 * three members: `entityMetadatas` to decide whether the entity is a tree
 * (empty ⇒ no), `options.type` to decide whether it is mongo (postgres ⇒ no),
 * and then `getRepository`.
 */
const stubRepository = {};

@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken(),
      useValue: {
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => stubRepository,
      },
    },
  ],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

describe('File routes', () => {
  let app: INestApplication;

  beforeAll(async () => {
    mockCanActivate.mockImplementation(() => true);

    const module = await Test.createTestingModule({
      imports: [FilesModule, LoggingModule, StubDataSourceModule],
      providers: [
        {
          provide: APP_GUARD,
          useClass: IdFormatGuard,
        },
      ],
    })
      .overrideGuard(JwtOrApiKeyAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideProvider(FileService)
      .useValue({
        upload: jest.fn().mockResolvedValue({ id: 'test-file-id' }),
        getFileHash: jest.fn().mockResolvedValue('test-hash'),
        findByHash: jest.fn().mockResolvedValue(null),
      })
      // Replaced rather than stubbed at the DataSource: the real binding is
      // PGBossEventService, whose onModuleInit opens queues against pg-boss.
      .overrideProvider(EventService)
      .useValue({})
      .compile();

    app = module.createNestApplication();

    // Manually set up the context middleware to inject the user into AsyncLocalStorage
    // This replaces the standard RequestContextMiddleware for testing purposes
    app.use((req: Request, res: Response, next: NextFunction) => {
      ContextService.run(
        {
          traceId: 'test-trace-id',
          userId: 'test-user-id', // Inject the user ID into the async storage
        },
        () => {
          next();
        },
      );
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('with valid auth credentials', () => {
    beforeEach(() => {
      mockCanActivate.mockImplementation(() => true);
    });

    it(`should return a 404 for GET → /files/foo`, () => {
      return request(app.getHttpServer()).get('/files/foo').expect(404);
    });

    it('should return a 201 for POST → /files/upload', async () => {
      const buffer = Buffer.from('Hello, world!');

      return request(app.getHttpServer())
        .post('/files/upload')
        .attach('files', buffer, 'hello.txt')
        .expect(201);
    });

    it('should accept large file uploads (verifying 50mb limit is applied)', async () => {
      // Create a large buffer (5MB) to verify that files endpoint
      // accepts larger payloads than the global 100kb limit
      const largeBuffer = Buffer.alloc(5 * 1024 * 1024, 'x');

      return request(app.getHttpServer())
        .post('/files/upload')
        .attach('files', largeBuffer, 'large-file.txt')
        .expect(201);
    });
  });

  describe('without valid auth credentials', () => {
    beforeEach(() => {
      mockCanActivate.mockImplementation(() => {
        throw new UnauthorizedException();
      });
    });

    it(`should return a 404 for GET → /files/foo`, () => {
      return request(app.getHttpServer()).get('/files/foo').expect(404);
    });

    it('should return a 401 for POST → /files/upload', async () => {
      return request(app.getHttpServer()).post('/files/upload').expect(401);
    });
  });
});
