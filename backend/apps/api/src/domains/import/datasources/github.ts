/* GitHub — starred repositories export (ghstars or GitHub account export). */
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams } from './timeline';
import { timeframeContains } from './timeline';

interface GHRepo {
  full_name?: string;
  html_url?: string;
  description?: string;
  language?: string;
  starred_at?: string;
}

interface GHElement extends GHRepo {
  repository?: GHRepo;
}

const GHSTARS_RE = /^ghstars(-.*)?\.json$/i;
const STARRED_RE = /^starred_repositories.*\.json$/i;

function isStarsFile(base: string): boolean {
  return GHSTARS_RE.test(base) || STARRED_RE.test(base);
}

export class GitHubFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root) {
      return { confidence: 0 };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch {
      return { confidence: 0 };
    }

    if (stat.isFile()) {
      const base = path.basename(root);
      if (!isStarsFile(base)) {
        return { confidence: 0 };
      }

      return this.parsesToNonEmptyArray(root) ? { confidence: 0.9 } : { confidence: 0 };
    }

    if (stat.isDirectory()) {
      try {
        const match = fs.readdirSync(root).find((n) => isStarsFile(n));
        if (match && this.parsesToNonEmptyArray(path.join(root, match))) {
          return { confidence: 0.9 };
        }
      } catch {
        /* ignore */
      }

      return { confidence: 0, dir_threshold: 0.7 };
    }

    return { confidence: 0 };
  }

  private parsesToNonEmptyArray(fpath: string): boolean {
    try {
      const parsed = JSON.parse(fs.readFileSync(fpath, 'utf8'));

      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const root = entry.fullPath || entry.fsRoot || entry.filename;
    if (!root) {
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch {
      return;
    }

    let fpath: string | undefined;
    if (stat.isFile()) {
      fpath = root;
    } else if (stat.isDirectory()) {
      try {
        const match = fs.readdirSync(root).find((n) => isStarsFile(n));
        if (match) {
          fpath = path.join(root, match);
        }
      } catch {
        return;
      }
    }

    if (!fpath) {
      return;
    }

    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', 'Failed to read GitHub stars export', { error: (e as Error).message });

      return;
    }

    let arr: GHElement[];
    try {
      arr = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(arr)) {
      return;
    }

    for (const el of arr) {
      if (!el || typeof el !== 'object') {
        continue;
      }

      const repo: GHRepo = el.repository || el;
      const starred = el.starred_at || repo.starred_at;
      let ts: Date | undefined = starred ? new Date(starred) : undefined;
      if (ts && isNaN(ts.getTime())) {
        ts = undefined;
      }

      if (!timeframeContains(params.timeframe, ts)) {
        continue;
      }

      const key = repo.full_name || repo.html_url;
      const content = key || '';
      params.pipeline.push({
        item: {
          id: key ? `github:star:${key}` : undefined,
          classification: 'social',
          timestamp: ts,
          content: { filename: 'star.txt', mediaType: 'text/plain', data: async () => Buffer.from(content) },
          metadata: {
            Name: repo.full_name || repo.html_url || undefined,
            Repo: repo.full_name || undefined,
            URL: repo.html_url || undefined,
            Description: repo.description || undefined,
            Language: repo.language || undefined,
            Kind: 'star',
            Source: 'GitHub',
          },
        },
      });
    }
  }
}

registerDataSource({
  name: 'github',
  title: 'GitHub',
  icon: '',
  description: 'Starred repositories from a ghstars or GitHub account data export.',
  newFileImporter: () => new GitHubFileImporter(),
});
