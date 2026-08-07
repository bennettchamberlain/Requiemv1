/* NMEA GPS sentences datasource (MVP) */
import fs from 'node:fs';
import path from 'node:path';

import type { FileImporter, DirEntry, Recognition } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Graph } from './timeline';
import { timeframeContains } from './timeline';

type NMEAOptions = Record<string, never>;

export class NMEAFileImporter implements FileImporter {
  async recognize(_ctx: unknown, entry: DirEntry): Promise<Recognition> {
    const full = entry.fullPath || entry.fsRoot || entry.filename;
    if (!full) {
      return { confidence: 0 };
    }

    try {
      if (fs.statSync(full).isFile()) {
        const ext = path.extname(full).toLowerCase();
        if (ext === '.nmea' || ext === '.log' || ext === '.txt') {
          const first = fs.readFileSync(full, 'utf8').split(/\n/).slice(0, 5).join('\n');
          if (/^\$GP(RMC|GGA)/m.test(first)) {
            return { confidence: 0.8 };
          }
        }
      }
    } catch {
      /* ignore */
    }

    return { confidence: 0 };
  }

  async fileImport(_ctx: unknown, entry: DirEntry, params: ImportParams): Promise<void> {
    const start = entry.fullPath || entry.fsRoot || entry.filename;
    if (!start) {
      return;
    }

    if (!fs.existsSync(start) || !fs.statSync(start).isFile()) {
      return;
    }

    const lines = fs.readFileSync(start, 'utf8').split(/\r?\n/);
    // Track last-seen RMC date so GPGGA sentences (which carry no date) can
    // inherit it instead of falling back to today.
    let lastRmcDate: string | undefined;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('$GP')) {
        continue;
      }

      const parts = line.split(',');
      if (parts[0] === '$GPRMC') {
        if (parts[9]?.length === 6) {
          lastRmcDate = parts[9];
        }

        this.parseGPRMC(parts, params, start, i);
      } else if (parts[0] === '$GPGGA') {
        this.parseGPGGA(parts, params, start, i, lastRmcDate);
      }
    }
  }

  private parseGPRMC(p: string[], params: ImportParams, file: string, lineIndex: number) {
    // $GPRMC,hhmmss.sss,A,llll.ll,a,yyyyy.yy,a,speed,track,date,...
    if (p.length < 10) {
      return;
    }

    if (p[2] !== 'A') {
      return;
    } // data valid

    const timeUTC = p[1];
    const date = p[9];
    const ts = parseDateTimeUTC(date, timeUTC);
    const lat = parseLat(p[3], p[4]);
    const lon = parseLon(p[5], p[6]);
    if (!timeframeContains(params.timeframe, ts)) {
      return;
    }

    if (lat === undefined || lon === undefined) {
      return;
    }

    pushLocation(params, ts, lat, lon, undefined, file, lineIndex, 'RMC');
  }

  private parseGPGGA(p: string[], params: ImportParams, file: string, lineIndex: number, rmcDate?: string) {
    // $GPGGA,hhmmss.sss,llll.ll,a,yyyyy.yy,a,fix,...,alt,M,...
    if (p.length < 10) {
      return;
    }

    const timeUTC = p[1];
    // Use the most recently seen RMC date; only fall back to today if no RMC
    // was seen at all (pure GGA-only file).
    const ts = parseDateTimeUTC(rmcDate, timeUTC);
    const lat = parseLat(p[2], p[3]);
    const lon = parseLon(p[4], p[5]);
    const alt = parseFloat(p[9]);
    if (lat === undefined || lon === undefined) {
      return;
    }

    pushLocation(params, ts, lat, lon, isNaN(alt) ? undefined : alt, file, lineIndex, 'GGA');
  }
}

function parseDateTimeUTC(dateDDMMYY: string | undefined, timeHHMMSS: string): Date | undefined {
  if (!timeHHMMSS) {
    return undefined;
  }

  let year: number, month: number, day: number;
  if (dateDDMMYY && dateDDMMYY.length === 6) {
    day = parseInt(dateDDMMYY.slice(0, 2), 10);
    month = parseInt(dateDDMMYY.slice(2, 4), 10) - 1;
    year = 2000 + parseInt(dateDDMMYY.slice(4, 6), 10);
  } else {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth();
    day = now.getUTCDate();
  }

  const hh = parseInt(timeHHMMSS.slice(0, 2), 10) || 0;
  const mm = parseInt(timeHHMMSS.slice(2, 4), 10) || 0;
  const ss = parseInt(timeHHMMSS.slice(4, 6), 10) || 0;

  return new Date(Date.UTC(year, month, day, hh, mm, ss));
}

function parseLat(raw: string, hemi: string): number | undefined {
  if (!raw) {
    return;
  }

  const deg = parseFloat(raw.slice(0, 2));
  const min = parseFloat(raw.slice(2));
  if (isNaN(deg) || isNaN(min)) {
    return;
  }

  let v = deg + min / 60;
  if (hemi === 'S') {
    v = -v;
  }

  return v;
}

function parseLon(raw: string, hemi: string): number | undefined {
  if (!raw) {
    return;
  }

  const deg = parseFloat(raw.slice(0, 3));
  const min = parseFloat(raw.slice(3));
  if (isNaN(deg) || isNaN(min)) {
    return;
  }

  let v = deg + min / 60;
  if (hemi === 'W') {
    v = -v;
  }

  return v;
}

function pushLocation(
  params: ImportParams,
  ts: Date | undefined,
  lat: number,
  lon: number,
  alt: number | undefined,
  source: string,
  lineIndex: number,
  tag: string,
) {
  if (!timeframeContains(params.timeframe, ts)) {
    return;
  }

  const item = {
    id: `nmea:${path.basename(source)}:${lineIndex}:${tag}`,
    classification: 'location',
    timestamp: ts,
    location: { latitude: lat, longitude: lon },
    metadata: { Name: `Location ${lat.toFixed(5)}, ${lon.toFixed(5)}`, Altitude: alt },
    content: { filename: path.basename(source), data: async () => Buffer.from('') },
  };
  const g: Graph = { item };
  params.pipeline.push(g);
}

registerDataSource({
  name: 'nmea',
  title: 'NMEA GPS',
  icon: 'nmea.svg',
  description: 'NMEA sentence logs ($GPRMC/$GPGGA) to location items (MVP)',
  newOptions: () => ({}) as NMEAOptions,
  newFileImporter: () => new NMEAFileImporter(),
});
