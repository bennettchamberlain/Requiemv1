import { resolveTelemetrySettings } from '../settings';

const DSN = 'https://publickey@o1.ingest.us.sentry.io/2';

describe('resolveTelemetrySettings', () => {
  it('is disabled when no DSN is configured', () => {
    const settings = resolveTelemetrySettings({}, 'ci-server-api');

    expect(settings.enabled).toBe(false);
    expect(settings.disabledReason).toBe('no-dsn');
  });

  it('is enabled once a DSN is present', () => {
    const settings = resolveTelemetrySettings({ SENTRY_DSN: DSN }, 'ci-server-api');

    expect(settings.enabled).toBe(true);
    expect(settings.disabledReason).toBeNull();
    expect(settings.dsn).toBe(DSN);
  });

  it.each(['off', 'OFF', 'false', '0', 'no', 'disabled'])(
    'CI_TELEMETRY=%s overrides a configured DSN',
    (value) => {
      const settings = resolveTelemetrySettings({ SENTRY_DSN: DSN, CI_TELEMETRY: value }, 'ci-server-api');

      expect(settings.enabled).toBe(false);
      expect(settings.disabledReason).toBe('opt-out');
    },
  );

  it.each(['on', 'true', '1', 'enabled', ''])('CI_TELEMETRY=%s leaves the DSN in charge', (value) => {
    const settings = resolveTelemetrySettings({ SENTRY_DSN: DSN, CI_TELEMETRY: value }, 'ci-server-api');

    expect(settings.enabled).toBe(true);
  });

  it.each(['true', 'TRUE', '1', 'yes', 'on'])('CI_LOCAL_ONLY=%s forbids all reporting', (value) => {
    const settings = resolveTelemetrySettings({ SENTRY_DSN: DSN, CI_LOCAL_ONLY: value }, 'ci-server-api');

    expect(settings.enabled).toBe(false);
    expect(settings.disabledReason).toBe('local-only');
  });

  it('reports local-only ahead of opt-out and missing DSN', () => {
    expect(resolveTelemetrySettings({ CI_LOCAL_ONLY: 'true', CI_TELEMETRY: 'off' }, 'x').disabledReason).toBe(
      'local-only',
    );
    expect(resolveTelemetrySettings({ CI_TELEMETRY: 'off' }, 'x').disabledReason).toBe('opt-out');
  });

  it('treats blank environment values as unset', () => {
    const settings = resolveTelemetrySettings({ SENTRY_DSN: '   ' }, 'ci-server-api');

    expect(settings.enabled).toBe(false);
    expect(settings.dsn).toBeNull();
  });

  it('derives the release from the deployment version when not set explicitly', () => {
    const settings = resolveTelemetrySettings(
      { SENTRY_DSN: DSN, CI_SERVER_VERSION: '2026.8.1' },
      'ci-server-api',
    );

    expect(settings.release).toBe('ci-server-api@2026.8.1');
    expect(settings.deploymentVersion).toBe('2026.8.1');
  });

  it('prefers an explicit SENTRY_RELEASE', () => {
    const settings = resolveTelemetrySettings(
      { SENTRY_DSN: DSN, CI_SERVER_VERSION: '2026.8.1', SENTRY_RELEASE: 'ci-server-api@abc123' },
      'ci-server-api',
    );

    expect(settings.release).toBe('ci-server-api@abc123');
  });

  it('falls back through SENTRY_ENV, CI_SERVER_ENVIRONMENT then NODE_ENV', () => {
    expect(resolveTelemetrySettings({ SENTRY_DSN: DSN, NODE_ENV: 'test' }, 'x').environment).toBe('test');
    expect(
      resolveTelemetrySettings({ SENTRY_DSN: DSN, NODE_ENV: 'test', CI_SERVER_ENVIRONMENT: 'appliance' }, 'x')
        .environment,
    ).toBe('appliance');
    expect(
      resolveTelemetrySettings(
        { SENTRY_DSN: DSN, NODE_ENV: 'test', CI_SERVER_ENVIRONMENT: 'appliance', SENTRY_ENV: 'staging' },
        'x',
      ).environment,
    ).toBe('staging');
    expect(resolveTelemetrySettings({ SENTRY_DSN: DSN }, 'x').environment).toBe('development');
  });
});
