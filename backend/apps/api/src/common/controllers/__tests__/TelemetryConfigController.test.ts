import { TelemetryConfigController } from '../TelemetryConfigController';

describe('TelemetryConfigController', () => {
  const controller = new TelemetryConfigController();
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('reports disabled when no DSN is configured', () => {
    delete process.env.SENTRY_DSN;

    expect(controller.telemetry()).toEqual({ enabled: false, reason: 'no-dsn' });
  });

  it('reports enabled when a DSN is configured', () => {
    process.env.SENTRY_DSN = 'https://k@o1.ingest.us.sentry.io/2';
    process.env.SENTRY_ENV = 'production';

    expect(controller.telemetry()).toMatchObject({ enabled: true, environment: 'production' });
  });

  it('honours the CI_TELEMETRY kill switch — this is what the marketplace toggle sets', () => {
    process.env.SENTRY_DSN = 'https://k@o1.ingest.us.sentry.io/2';
    process.env.CI_TELEMETRY = 'off';

    expect(controller.telemetry()).toEqual({ enabled: false, reason: 'opt-out' });
  });

  it('honours local-only mode', () => {
    process.env.SENTRY_DSN = 'https://k@o1.ingest.us.sentry.io/2';
    process.env.CI_LOCAL_ONLY = 'true';

    expect(controller.telemetry()).toEqual({ enabled: false, reason: 'local-only' });
  });

  it('never returns the DSN itself', () => {
    process.env.SENTRY_DSN = 'https://supersecret@o1.ingest.us.sentry.io/2';

    expect(JSON.stringify(controller.telemetry())).not.toContain('supersecret');
  });
});
