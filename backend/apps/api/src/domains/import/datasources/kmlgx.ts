/* KML (Keyhole) with Google gx:Track extension datasource (TypeScript port) */
import fs from 'node:fs';
import path from 'node:path';

import { parseStringPromise, processors } from 'xml2js';

import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Item } from './timeline';
import { timeframeContains } from './timeline';

// xml2js options: strip namespace prefixes so <gx:Track> → Track, <gx:coord> → coord,
// and xmlns:gx → gx in the $ attributes object. This makes real Google KML exports
// parse identically to the simple test fixtures.
const XML2JS_OPTS = {
  tagNameProcessors: [processors.stripPrefix],
  attrNameProcessors: [processors.stripPrefix],
};

interface KMLGXOptions {
  ownerEntityId?: number;
}

interface KMLDocument {
  kml?: {
    // xml2js stores namespace declarations as attribute keys. The realistic
    // Google KML attribute is `xmlns:gx`; attrNameProcessors doesn't strip
    // namespace declarations, so we check both `gx` and `xmlns:gx`.
    $?: { gx?: string; [key: string]: string | undefined };
    Document?: Array<{
      Placemark?: Array<{
        Track?: Array<{
          when?: string[];
          coord?: string[];
        }>;
      }>;
    }>;
  };
}

const GX_NS_PREFIX = 'http://www.google.com/kml/ext/2';

function hasGxNS(doc: KMLDocument): boolean {
  const attrs = doc.kml?.$ ?? {};

  return !!(attrs['gx']?.startsWith(GX_NS_PREFIX) || attrs['xmlns:gx']?.startsWith(GX_NS_PREFIX));
}

export class KMLGXFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full) {
      return { confidence: 0 };
    }

    if (fs.existsSync(full) && fs.statSync(full).isFile() && path.extname(full).toLowerCase() === '.kml') {
      try {
        const xml = await fs.promises.readFile(full, 'utf8');
        const doc: KMLDocument = await parseStringPromise(xml, XML2JS_OPTS);
        if (hasGxNS(doc)) {
          return { confidence: 1.0 };
        }
      } catch {
        /* ignore parse errors */
      }
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const start = entry.fullPath || entry.fsRoot || entry.filename;
    if (!start) {
      return;
    }

    const stat = fs.statSync(start);
    if (stat.isDirectory()) {
      for await (const fpath of this.walkDir(start)) {
        if (fpath.toLowerCase().endsWith('.kml')) {
          await this.processKML(fpath, params);
        }
      }
    } else {
      if (path.extname(start).toLowerCase() === '.kml') {
        await this.processKML(start, params);
      }
    }
  }

  private async *walkDir(root: string): AsyncGenerator<string> {
    const ents = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of ents) {
      const full = path.join(root, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) {
          continue;
        }

        yield* this.walkDir(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
  }

  private async processKML(fpath: string, params: ImportParams): Promise<void> {
    try {
      const xml = await fs.promises.readFile(fpath, 'utf8');
      const doc: KMLDocument = await parseStringPromise(xml, XML2JS_OPTS);
      if (!hasGxNS(doc)) {
        params.log?.('warn', 'KML file missing gx namespace', { file: path.basename(fpath) });

        return;
      }

      const tracks = (doc.kml?.Document || [])
        .flatMap((d) => d.Placemark || [])
        .flatMap((p) => p.Track || []);
      for (const track of tracks) {
        const whens = track.when || [];
        const coords = track.coord || [];
        if (whens.length !== coords.length) {
          params.log?.('warn', 'Track timestamp/coord count mismatch', { file: path.basename(fpath) });
          continue;
        }

        for (let i = 0; i < whens.length; i++) {
          const fields = coords[i].trim().split(/\s+/);
          if (fields.length < 2) {
            continue;
          }

          const lon = parseFloat(fields[0]);
          const lat = parseFloat(fields[1]);
          const alt = fields.length >= 3 ? parseFloat(fields[2]) : undefined;
          if (isNaN(lat) || isNaN(lon)) {
            continue;
          }

          const ts = new Date(whens[i]);
          const item: Item = {
            classification: 'location',
            timestamp: isNaN(ts.getTime()) ? undefined : ts,
            location: { latitude: lat, longitude: lon },
            intermediateLocation: fpath,
            content: { filename: path.basename(fpath) },
            metadata: {
              Source: 'KMLGX',
              Name: `Location ${lat.toFixed(5)},${lon.toFixed(5)}`,
              ...(alt !== undefined && !isNaN(alt) && { Altitude: alt }),
            },
          };
          if (timeframeContains(params.timeframe, item.timestamp)) {
            params.pipeline.push({ item });
          }
        }
      }
    } catch (e) {
      params.log?.('error', 'Failed to parse KML file', {
        file: path.basename(fpath),
        error: (e as Error).message,
      });
    }
  }
}

registerDataSource({
  name: 'kmlgx',
  title: 'Keyhole (KML GX)',
  icon: 'kml.svg',
  description: 'A .kml file or folder of .kml with gx:Track entries (Google extension)',
  newOptions: () => ({ ownerEntityId: undefined }) as KMLGXOptions,
  newFileImporter: () => new KMLGXFileImporter(),
});
