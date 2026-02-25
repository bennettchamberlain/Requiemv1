import { type INestApplication, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { BodyParserMiddleware } from '@ci/common/middleware';
import config from '@ci/configuration';
import { UserService } from '@ci/domains/user';

import { SessionController } from '../controllers/SessionController';
import { AuthService } from '../services/AuthService';

import { parseCookies } from './utils/parseCookies';

const COOKIE_NAME = config.auth.cookies.sessionTokenName;

const mockUser = { id: 'user-1', name: 'Test User', email: 'test@example.com' };

const mockAuthService = {
  issueSessionToken: jest.fn().mockResolvedValue('session-token-value'),
  issueAccessToken: jest.fn().mockReturnValue('access-token-value'),
  getSessionMetadata: jest.fn().mockReturnValue({ ip: '127.0.0.1', userAgent: 'test' }),
  validateSessionToken: jest.fn().mockReturnValue({ sub: 'user-1' }),
  rotateSessionToken: jest.fn().mockResolvedValue('rotated-session-token'),
  invalidateSession: jest.fn().mockResolvedValue(undefined),
};

const mockUserService = {
  validatePassword: jest.fn().mockResolvedValue(mockUser),
  findById: jest.fn().mockResolvedValue(mockUser),
};

@Module({
  controllers: [SessionController],
  providers: [
    { provide: AuthService, useValue: mockAuthService },
    { provide: UserService, useValue: mockUserService },
  ],
})
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BodyParserMiddleware).forRoutes('*');
  }
}

describe('SessionController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    app = module.createNestApplication({
      bodyParser: false,
      logger: false,
    });

    app.use(cookieParser());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserService.validatePassword.mockResolvedValue(mockUser);
    mockUserService.findById.mockResolvedValue(mockUser);
    mockAuthService.issueSessionToken.mockResolvedValue('session-token-value');
    mockAuthService.issueAccessToken.mockReturnValue('access-token-value');
    mockAuthService.validateSessionToken.mockReturnValue({ sub: 'user-1' });
    mockAuthService.rotateSessionToken.mockResolvedValue('rotated-session-token');
  });

  describe('POST /authenticate (login)', () => {
    it('should set session token as httpOnly cookie on successful login', async () => {
      const response = await request(app.getHttpServer())
        .post('/authenticate')
        .send({ username: 'test@example.com', password: 'password123' })
        .expect(200);

      const cookies = parseCookies(response);
      expect(cookies[COOKIE_NAME]).toBeDefined();
      expect(cookies[COOKIE_NAME].value).toBe('session-token-value');
      expect(cookies[COOKIE_NAME].httpOnly).toBe(true);
      expect(cookies[COOKIE_NAME].path).toBe('/');
    });

    it('should return access token in the response body', async () => {
      const response = await request(app.getHttpServer())
        .post('/authenticate')
        .send({ username: 'test@example.com', password: 'password123' })
        .expect(200);

      expect(response.body).toEqual({ accessToken: 'access-token-value' });
    });

    it('should not return session token in the response body', async () => {
      const response = await request(app.getHttpServer())
        .post('/authenticate')
        .send({ username: 'test@example.com', password: 'password123' })
        .expect(200);

      expect(response.body.sessionToken).toBeUndefined();
    });

    it('should set cookie with maxAge', async () => {
      const response = await request(app.getHttpServer())
        .post('/authenticate')
        .send({ username: 'test@example.com', password: 'password123' })
        .expect(200);

      const cookies = parseCookies(response);
      expect(cookies[COOKIE_NAME].maxAge).toBeDefined();
    });

    it('should return 401 when credentials are invalid', async () => {
      mockUserService.validatePassword.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/authenticate')
        .send({ username: 'bad@example.com', password: 'wrong' })
        .expect(401);
    });
  });

  describe('POST /authenticate/refresh', () => {
    it('should set a new session token cookie on refresh', async () => {
      const response = await request(app.getHttpServer())
        .post('/authenticate/refresh')
        .set('Cookie', [`${COOKIE_NAME}=session-token-value`])
        .expect(200);

      const cookies = parseCookies(response);
      expect(cookies[COOKIE_NAME]).toBeDefined();
      expect(cookies[COOKIE_NAME].value).toBe('rotated-session-token');
      expect(cookies[COOKIE_NAME].httpOnly).toBe(true);
    });

    it('should return a new access token in the body', async () => {
      const response = await request(app.getHttpServer())
        .post('/authenticate/refresh')
        .set('Cookie', [`${COOKIE_NAME}=session-token-value`])
        .expect(200);

      expect(response.body).toEqual({ accessToken: 'access-token-value' });
    });

    it('should return 400 when no session cookie is present', async () => {
      await request(app.getHttpServer()).post('/authenticate/refresh').expect(400);
    });

    it('should return 401 when session token is invalid', async () => {
      mockAuthService.validateSessionToken.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await request(app.getHttpServer())
        .post('/authenticate/refresh')
        .set('Cookie', [`${COOKIE_NAME}=invalid-token`])
        .expect(401);
    });

    it('should return 401 when user no longer exists', async () => {
      mockUserService.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/authenticate/refresh')
        .set('Cookie', [`${COOKIE_NAME}=session-token-value`])
        .expect(401);
    });
  });

  describe('POST /authenticate/logout', () => {
    it('should clear session token cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/authenticate/logout')
        .set('Cookie', [`${COOKIE_NAME}=session-token-value`])
        .expect(204);

      const cookies = parseCookies(response);
      expect(cookies[COOKIE_NAME]).toBeDefined();
      // cleared cookies have an empty value or an expiry in the past
      expect(cookies[COOKIE_NAME].value === '' || cookies[COOKIE_NAME].expires?.getTime() === 0).toBe(true);
    });

    it('should invalidate the session in the database', async () => {
      await request(app.getHttpServer())
        .post('/authenticate/logout')
        .set('Cookie', [`${COOKIE_NAME}=session-token-value`])
        .expect(204);

      expect(mockAuthService.invalidateSession).toHaveBeenCalledWith(
        'user-1',
        'session-token-value',
        expect.any(Object),
      );
    });

    it('should return 400 when no session cookie is present', async () => {
      await request(app.getHttpServer()).post('/authenticate/logout').expect(400);
    });

    it('should return 401 when user no longer exists', async () => {
      mockUserService.findById.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/authenticate/logout')
        .set('Cookie', [`${COOKIE_NAME}=session-token-value`])
        .expect(401);
    });
  });
});
