import { buildProgram, resolveTarget, DEFAULT_SERVER_URL } from '../program';

import { recordingTerm } from './support/harness';

/**
 * The CLI's contract with whoever types `ci-import`: which commands exist, and
 * where it decides to send them.
 */
describe('ci-import program', () => {
  it('lists every command in --help', async () => {
    const term = recordingTerm();
    const program = buildProgram({ term }).exitOverride();

    await expect(program.parseAsync(['node', 'ci-import', '--help'])).rejects.toMatchObject({
      code: 'commander.helpDisplayed',
    });

    const help = term.text();

    for (const command of [
      'datasources',
      'recognize',
      'import',
      'inbox',
      'runs',
      'push',
      'stats',
      'backfill',
    ]) {
      expect(help).toContain(command);
    }
  });

  it('tells the reader how to point it at an appliance', async () => {
    const term = recordingTerm();
    const program = buildProgram({ term }).exitOverride();

    await expect(program.parseAsync(['node', 'ci-import', '--help'])).rejects.toBeDefined();

    expect(term.text()).toContain('CI_SERVER_URL');
    expect(term.text()).toContain('CI_API_KEY');
  });

  it('routes a global flag into the command it precedes', async () => {
    const term = recordingTerm();
    const seen: Array<string | undefined> = [];
    const program = buildProgram({
      term,
      makeClient: (options) => {
        seen.push(options.server);

        return { listSources: async () => [] } as never;
      },
    }).exitOverride();

    await program.parseAsync(['node', 'ci-import', '--server', 'http://box:3030', 'datasources']);

    expect(seen).toEqual(['http://box:3030']);
  });

  describe('resolveTarget', () => {
    it('prefers the flag, then the environment, then the default', () => {
      expect(resolveTarget({ server: 'http://flag' }, { CI_SERVER_URL: 'http://env' }).baseUrl).toBe(
        'http://flag',
      );
      expect(resolveTarget({}, { CI_SERVER_URL: 'http://env' }).baseUrl).toBe('http://env');
      expect(resolveTarget({}, {}).baseUrl).toBe(DEFAULT_SERVER_URL);
    });

    it('accepts either spelling of the api key env var', () => {
      expect(resolveTarget({}, { CI_API_KEY: 'a' }).apiKey).toBe('a');
      expect(resolveTarget({}, { CI_SERVER_API_KEY: 'b' }).apiKey).toBe('b');
      expect(resolveTarget({}, { CI_API_KEY: 'a', CI_SERVER_API_KEY: 'b' }).apiKey).toBe('a');
    });

    it('never invents a key — an empty credential must not become an opaque 401', () => {
      expect(resolveTarget({}, {}).apiKey).toBeNull();
    });
  });
});
