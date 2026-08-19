import fs from 'fs';
import os from 'os';
import path from 'path';

import { GitHubFileImporter } from '../github';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('GitHub datasource', () => {
  it('recognizes directory containing ghstars.json', async () => {
    const root = path.join(FIXTURES_DIR, 'github-export');
    const fi = new GitHubFileImporter();
    const rec = await fi.recognize({}, { filename: 'github-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes single ghstars.json file', async () => {
    const fpath = path.join(FIXTURES_DIR, 'github-export', 'ghstars.json');
    const fi = new GitHubFileImporter();
    const rec = await fi.recognize({}, { filename: 'ghstars.json', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('imports starred repos as social items', async () => {
    const fpath = path.join(FIXTURES_DIR, 'github-export', 'ghstars.json');
    const fi = new GitHubFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'ghstars.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(2);
    expect(pipeline.every((p) => p.item.classification === 'social')).toBe(true);
  });

  it('parses star metadata correctly', async () => {
    const fpath = path.join(FIXTURES_DIR, 'github-export', 'ghstars.json');
    const fi = new GitHubFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'ghstars.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const m = pipeline[0].item.metadata;
    expect(m.Repo).toBe('companionintelligence/CI-Server');
    expect(m.URL).toBe('https://github.com/companionintelligence/CI-Server');
    expect(m.Kind).toBe('star');
    expect(m.Source).toBe('GitHub');
    // Title-bearing key so titleFor renders the repo, not the bare 'star.txt' filename.
    expect(m.Name).toBe('companionintelligence/CI-Server');
    expect(m.Name).not.toBe('star.txt');
    expect(pipeline[0].item.timestamp).toBeDefined();
  });

  it('falls back to html_url for the title when full_name is missing', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const fpath = path.join(tmp, 'ghstars.json');
    fs.writeFileSync(fpath, JSON.stringify([{ html_url: 'https://github.com/octocat/Only-Url' }]));
    const fi = new GitHubFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'ghstars.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline[0].item.metadata.Name).toBe('https://github.com/octocat/Only-Url');
    expect(pipeline[0].item.metadata.Name).not.toBe('star.txt');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('handles GitHub official export shape (repository nested)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const fpath = path.join(tmp, 'starred_repositories.json');
    fs.writeFileSync(
      fpath,
      JSON.stringify([
        {
          starred_at: '2023-05-01T00:00:00Z',
          repository: {
            full_name: 'octocat/Hello-World',
            html_url: 'https://github.com/octocat/Hello-World',
            description: 'demo',
          },
        },
      ]),
    );
    const fi = new GitHubFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'starred_repositories.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.metadata.Repo).toBe('octocat/Hello-World');
    expect(pipeline[0].item.timestamp).toBeDefined();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('assigns stable unique ids so same/missing-timestamp stars do not collapse', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const fpath = path.join(tmp, 'ghstars.json');
    // No starred_at on any row -> timestamps undefined; constant filename 'star.txt'.
    // Without a stable id these would all hash to the same dedup key and collapse.
    fs.writeFileSync(
      fpath,
      JSON.stringify([
        { full_name: 'octocat/Hello-World', html_url: 'https://github.com/octocat/Hello-World' },
        { full_name: 'octocat/Spoon-Knife', html_url: 'https://github.com/octocat/Spoon-Knife' },
        { html_url: 'https://github.com/octocat/Only-Url' },
      ]),
    );
    const fi = new GitHubFileImporter();
    const run = async () => {
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'ghstars.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      return pipeline;
    };

    const pipeline = await run();
    expect(pipeline.length).toBe(3);
    const ids = pipeline.map((p) => p.item.id!);
    expect(ids.every((id) => !!id)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // Re-import yields identical ids (idempotent).
    const again = await run();
    expect(again.map((p) => p.item.id!)).toEqual(ids);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('malformed input does not throw', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const fpath = path.join(tmp, 'ghstars.json');
    fs.writeFileSync(fpath, 'not json at all \x00\xff [[[ }}}');
    const fi = new GitHubFileImporter();
    const pipeline: EmittedGraph[] = [];
    await expect(
      fi.fileImport({}, { filename: 'ghstars.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams),
    ).resolves.toBeUndefined();
    expect(pipeline.length).toBe(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('empty input yields no items', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const fpath = path.join(tmp, 'ghstars.json');
    fs.writeFileSync(fpath, '[]');
    const fi = new GitHubFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'ghstars.json', fullPath: fpath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline.length).toBe(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
