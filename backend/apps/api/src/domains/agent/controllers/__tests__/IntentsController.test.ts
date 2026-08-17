import type { IntentCatalogService, IntentManifest } from '@ci/domains/tools';

import { IntentsController } from '../IntentsController';

/**
 * The controller is a thin publisher over the tools-domain IntentCatalogService, so it's tested
 * against a stub catalog (public API only — no reach into tools internals). The end-to-end
 * "real tools broadcast their full schema" check lives with the catalog in the tools domain.
 */
const MANIFEST: IntentManifest = {
  version: '1.0.0',
  generatedAt: '2026-06-30T00:00:00.000Z',
  domains: [{ key: 'people', title: 'People', description: 'People and relationships.' }],
  entities: [{ type: 'person', title: 'Person', description: 'A person.', idKind: 'global-uid' }],
  intents: [
    {
      name: 'people.find',
      tool: 'people_find',
      domain: 'people',
      title: 'Find people',
      description: 'Find people in the social graph.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      privacy: { access: 'read', sensitivity: 'personal', destructive: false, external: false },
      localCapable: true,
      consumes: [],
      produces: ['person'],
      phrases: ['Find $name'],
    },
  ],
};

function controllerWith(manifest: IntentManifest = MANIFEST): IntentsController {
  const catalog = {
    getManifest: () => manifest,
    getDomains: () => manifest.domains,
    getEntities: () => manifest.entities,
  } as unknown as IntentCatalogService;

  return new IntentsController(catalog);
}

/** Captures what the controller forwarded to the catalog, which is the whole contract of `?tier=`. */
function controllerSpy(): { controller: IntentsController; calls: unknown[] } {
  const calls: unknown[] = [];
  const catalog = {
    getManifest: (options: unknown) => {
      calls.push(options);

      return MANIFEST;
    },
    getDomains: () => MANIFEST.domains,
    getEntities: () => MANIFEST.entities,
  } as unknown as IntentCatalogService;

  return { controller: new IntentsController(catalog), calls };
}

describe('IntentsController', () => {
  it('publishes the full manifest', () => {
    expect(controllerWith().getManifest()).toEqual(MANIFEST);
  });

  it('exposes the domain and entity vocabularies', () => {
    expect(controllerWith().getDomains()).toEqual({ domains: MANIFEST.domains });
    expect(controllerWith().getEntities()).toEqual({ entities: MANIFEST.entities });
  });

  it('serves a single intent by its dotted name', () => {
    expect(controllerWith().getIntent('people.find').tool).toBe('people_find');
  });

  it('404s an unknown intent', () => {
    expect(() => controllerWith().getIntent('nope.notReal')).toThrow('Unknown intent: nope.notReal');
  });

  describe('?tier=', () => {
    it('asks the catalog for no tier when the param is absent or empty', () => {
      const { controller, calls } = controllerSpy();

      controller.getManifest();
      controller.getManifest('');

      expect(calls).toEqual([{ tier: undefined }, { tier: undefined }]);
    });

    it('forwards a recognized tier', () => {
      const { controller, calls } = controllerSpy();

      controller.getManifest('local');
      controller.getManifest('appliance');

      expect(calls).toEqual([{ tier: 'local' }, { tier: 'appliance' }]);
    });

    it('rejects an unrecognized tier instead of silently ignoring it', () => {
      // Load-bearing: a client that asked for rulings and silently got none would read every
      // `dispatch` as undefined and — depending on how it defaults — either refuse everything or,
      // far worse, run everything.
      expect(() => controllerWith().getManifest('locale')).toThrow('Unknown dispatch tier: locale');
      expect(() => controllerWith().getManifest('LOCAL')).toThrow('Unknown dispatch tier: LOCAL');
    });

    it('honours the tier on the single-intent route too', () => {
      const { controller, calls } = controllerSpy();

      controller.getIntent('people.find', 'local');

      expect(calls).toEqual([{ tier: 'local' }]);
      expect(() => controllerWith().getIntent('people.find', 'nope')).toThrow('Unknown dispatch tier: nope');
    });
  });
});
