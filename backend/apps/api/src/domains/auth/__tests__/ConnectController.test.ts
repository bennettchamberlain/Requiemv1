import { type INestApplication, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { HubForwardAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { BodyParserMiddleware } from '@ci/common/middleware';
import config from '@ci/configuration';

import { ConnectController } from '../controllers/ConnectController';
import { CsrfGuard } from '../guards/CsrfGuard';
import { ConnectService } from '../services/ConnectService';

const SESSION_COOKIE = config.auth.cookies.sessionTokenName;
const RETURN_URL = 'https://hub.example.com/apps/urn:app:x/memory-connect/callback';

const mockConnectService = {
  resolveSessionUser: jest.fn(),
  isReturnUrlAllowed: jest.fn(),
  approve: jest.fn(),
  exchange: jest.fn(),
  revokeByApp: jest.fn(),
  buildReturnUrl: jest.fn(),
};

const mockLogger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

@Module({
  controllers: [ConnectController],
  providers: [
    { provide: ConnectService, useValue: mockConnectService },
    { provide: LoggerService, useValue: mockLogger },
  ],
})
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BodyParserMiddleware).forRoutes('*');
  }
}

/**
 * HTTP-level tests for the connect endpoints. ConnectService is mocked (its
 * logic is unit-tested separately); CSRF and forward-auth guards are overridden
 * to true so these tests focus on the controller's routing, validation, session
 * gating, and redirect behaviour.
 */
describe('ConnectController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(HubForwardAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication({ bodyParser: false, logger: false });
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectService.isReturnUrlAllowed.mockReturnValue(true);
    mockConnectService.buildReturnUrl.mockImplementation(
      (url: string, code: string, state: string) => `${url}?code=${code}&state=${state}`,
    );
  });

  describe('GET /connect', () => {
    it('400s when required params are missing', async () => {
      await request(app.getHttpServer()).get('/connect').query({ app: 'urn:app:x' }).expect(400);
    });

    it('400s when the return URL origin is not allowlisted', async () => {
      mockConnectService.isReturnUrlAllowed.mockReturnValue(false);

      await request(app.getHttpServer())
        .get('/connect')
        .query({ app: 'urn:app:x', state: 's', return: 'https://evil.example.com/cb' })
        .expect(400);

      expect(mockConnectService.resolveSessionUser).not.toHaveBeenCalled();
    });

    it('redirects to OIDC sign-in (returning to itself) when there is no session', async () => {
      mockConnectService.resolveSessionUser.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/connect')
        .query({ app: 'urn:app:x', state: 's', return: RETURN_URL })
        .expect(302);

      expect(res.headers.location).toContain('/api/authenticate/oidc?redirect=');
      expect(decodeURIComponent(res.headers.location)).toContain('/api/connect?');
    });

    it('renders the consent page with anti-framing headers when signed in', async () => {
      mockConnectService.resolveSessionUser.mockResolvedValue({ userId: 'user-1' });

      const res = await request(app.getHttpServer())
        .get('/connect')
        .query({ app: 'urn:app:x', state: 's', return: RETURN_URL })
        .set('Cookie', [`${SESSION_COOKIE}=tok`])
        .expect(200);

      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.text).toContain('Connect to Companion Memory');
    });
  });

  describe('POST /connect/approve', () => {
    it('mints and returns the Hub redirect URL when signed in', async () => {
      mockConnectService.resolveSessionUser.mockResolvedValue({ userId: 'user-1' });
      mockConnectService.approve.mockResolvedValue({ code: 'the-code' });

      const res = await request(app.getHttpServer())
        .post('/connect/approve')
        .send({ app: 'urn:app:x', state: 's', return: RETURN_URL })
        .expect(201);

      expect(mockConnectService.approve).toHaveBeenCalledWith('user-1', 'urn:app:x');
      expect(res.body.redirectUrl).toBe(`${RETURN_URL}?code=the-code&state=s`);
    });

    it('401s when there is no session', async () => {
      mockConnectService.resolveSessionUser.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/connect/approve')
        .send({ app: 'urn:app:x', state: 's', return: RETURN_URL })
        .expect(401);

      expect(mockConnectService.approve).not.toHaveBeenCalled();
    });

    it('400s when the return URL is not a valid URL (validation)', async () => {
      mockConnectService.resolveSessionUser.mockResolvedValue({ userId: 'user-1' });

      await request(app.getHttpServer())
        .post('/connect/approve')
        .send({ app: 'urn:app:x', state: 's', return: 'not-a-url' })
        .expect(400);
    });
  });

  describe('POST /connect/exchange', () => {
    it('returns the raw key for a valid code', async () => {
      mockConnectService.exchange.mockResolvedValue({ appUrn: 'urn:app:x', key: 'raw-key' });

      const res = await request(app.getHttpServer())
        .post('/connect/exchange')
        .send({ code: 'the-code' })
        .expect(201);

      expect(res.body).toEqual({ appUrn: 'urn:app:x', key: 'raw-key' });
    });

    it('400s for an invalid/expired code', async () => {
      mockConnectService.exchange.mockResolvedValue(null);

      await request(app.getHttpServer()).post('/connect/exchange').send({ code: 'bad' }).expect(400);
    });
  });

  describe('POST /connect/revoke', () => {
    it('revokes by app and returns the count', async () => {
      mockConnectService.revokeByApp.mockResolvedValue(1);

      const res = await request(app.getHttpServer())
        .post('/connect/revoke')
        .send({ app: 'urn:app:x' })
        .expect(201);

      expect(mockConnectService.revokeByApp).toHaveBeenCalledWith('urn:app:x');
      expect(res.body).toEqual({ revoked: 1 });
    });
  });
});
