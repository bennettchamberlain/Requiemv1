import fs from 'fs';
import { parse, type CastingContext } from 'csv-parse/sync';

function isIsoDate(value: string): boolean {
  // Checks for ISO date strings with optional timezone offset
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)?)?$/.test(value);
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function readCsv<T = Record<string, string | number | boolean | Date | null>>(filePath: string): T[] {
  const fileContent = fs.readFileSync(filePath, 'utf8');

  return parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: (value: any, _context: CastingContext) => {
      if (value === '') {
        return null;
      }

      if (value === 'true') {
        return true;
      }

      if (value === 'false') {
        return false;
      }

      if (!isNaN(value) && value.trim() !== '') {
        return Number(value);
      }

      if (isIsoDate(value)) {
        return new Date(value);
      }

      return value;
    },
  }) as T[];
}
