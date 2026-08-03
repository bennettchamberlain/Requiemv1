import { type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HealthController } from '../HealthController';

@Module({
  controllers: [HealthController],
})
class HealthTestModule {}

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await request(app.getHttpServer()).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    });

    // Capture clients (browser extension, applet, importer) authenticate ONLY
    // with a portal token, so when portal auth is off every one of their
    // requests 401s and the guard cannot say why — a rejected token is
    // indistinguishable from an absent one. Publishing the flag here is what
    // lets a client tell "my token is bad" apart from "this server does not
    // accept portal tokens at all".
    it('publishes whether the server accepts portal OIDC tokens', async () => {
      const res = await request(app.getHttpServer()).get('/health');

      expect(typeof res.body.portalAuthEnabled).toBe('boolean');
    });

    it('responds to repeated calls (liveness probe semantics)', async () => {
      // Sequential, not Promise.all: parallel supertest requests each spin up a
      // fresh ephemeral listener on the same un-listened server and race to bind,
      // which flakes in CI. A liveness probe only needs to stay 200 across calls.
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer()).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
      }
    });

    it('does not require authentication', async () => {
      // Health check is intentionally unauthenticated so CI-Gateway and external
      // probes (Companion Hub, container orchestrators) can reach it without
      // managing credentials. If this test starts failing, the gateway and
      // operational monitoring will silently stop reporting Server health.
      const res = await request(app.getHttpServer())
        .get('/health')
        // explicitly no auth header / cookie
        .set('Authorization', '');

      expect(res.status).toBe(200);
    });
  });
});
