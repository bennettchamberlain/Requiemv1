import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppleHealthFileImporter } from '../apple_health';
import { DiscordFileImporter } from '../discord';
import { LinkedInFileImporter } from '../linkedin';
import { NotionFileImporter } from '../notion';
import { RedditFileImporter } from '../reddit';
import { StravaFileImporter } from '../strava';
import { WithingsFileImporter } from '../withings';

/**
 * Recognizers must verify CONTENT, not just names — each case here is the
 * real-world impostor that fooled (or would fool) the filename-only version:
 * Google Takeout ships a YouTube comment history named `comments.csv`, any
 * archive can carry a readme.md, any fitness service an activities.csv, any
 * XML dump an export.xml. The positive twins prove the checks accept exactly
 * what each parser can read.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sniff-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const fpath = path.join(dir, name);

  fs.mkdirSync(path.dirname(fpath), { recursive: true });
  fs.writeFileSync(fpath, content);

  return fpath;
}

describe('Reddit recognizer verifies CSV headers', () => {
  it('rejects a YouTube comment history that happens to be named comments.csv — THE incident', async () => {
    const fpath = write(
      'comments.csv',
      'Comment ID,Channel ID,Comment Create Timestamp,Price,Parent Comment ID,Video ID,Comment Text\n',
    );

    const rec = await new RedditFileImporter().recognize({}, { filename: 'comments.csv', fullPath: fpath });

    expect(rec.confidence).toBe(0);
  });

  it('rejects a directory of impostor CSVs that clears the old two-name bar', async () => {
    write('impostors/comments.csv', 'Comment ID,Video ID,Comment Text\n');
    write('impostors/posts.csv', 'title,url,published\n');

    const rec = await new RedditFileImporter().recognize(
      {},
      { filename: 'impostors', fullPath: path.join(dir, 'impostors') },
    );

    expect(rec.confidence).toBe(0);
  });

  it('still accepts a real Reddit comments.csv', async () => {
    const fpath = write(
      'comments.csv',
      'id,permalink,date,ip,subreddit,gildings,link,parent,body,score,url\n',
    );

    const rec = await new RedditFileImporter().recognize({}, { filename: 'comments.csv', fullPath: fpath });

    expect(rec.confidence).toBeGreaterThan(0);
  });
});

describe('Strava recognizer verifies the activities header', () => {
  it('rejects some other service’s activities.csv', async () => {
    const fpath = write('activities.csv', 'Date,Type,Distance,Duration\n');

    const rec = await new StravaFileImporter().recognize({}, { filename: 'activities.csv', fullPath: fpath });

    expect(rec.confidence).toBe(0);
  });

  it('accepts Strava’s own header', async () => {
    const fpath = write('activities.csv', 'Activity ID,Activity Date,Activity Name,Activity Type\n');

    const rec = await new StravaFileImporter().recognize({}, { filename: 'activities.csv', fullPath: fpath });

    expect(rec.confidence).toBeGreaterThan(0);
  });
});

describe('LinkedIn directory recognition verifies file heads', () => {
  it('rejects a directory whose messages.csv is not LinkedIn’s', async () => {
    write('export/messages.csv', 'from,to,text,timestamp\n');

    const rec = await new LinkedInFileImporter().recognize(
      {},
      { filename: 'export', fullPath: path.join(dir, 'export') },
    );

    expect(rec.confidence).toBe(0);
  });

  it('accepts Connections.csv behind LinkedIn’s Notes: preamble', async () => {
    write(
      'export/Connections.csv',
      'Notes:\n"When exporting your connection data, you may notice..."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n',
    );

    const rec = await new LinkedInFileImporter().recognize(
      {},
      { filename: 'export', fullPath: path.join(dir, 'export') },
    );

    expect(rec.confidence).toBeGreaterThan(0);
  });
});

describe('Apple Health recognizer verifies the HealthKit root element', () => {
  it('rejects an unrelated export.xml', async () => {
    const fpath = write('export.xml', '<?xml version="1.0"?>\n<catalog><item/></catalog>\n');

    const rec = await new AppleHealthFileImporter().recognize(
      {},
      { filename: 'export.xml', fullPath: fpath },
    );

    expect(rec.confidence).toBe(0);
  });

  it('accepts a HealthKit export', async () => {
    const fpath = write('export.xml', '<?xml version="1.0"?>\n<HealthData locale="en_US">\n');

    const rec = await new AppleHealthFileImporter().recognize(
      {},
      { filename: 'export.xml', fullPath: fpath },
    );

    expect(rec.confidence).toBeGreaterThan(0);
  });
});

describe('Notion recognizer requires the export id suffix', () => {
  it('rejects a bare readme.md — the Amazon-archive impostor', async () => {
    const fpath = write('readme.md', '# About this archive\n');

    const rec = await new NotionFileImporter().recognize({}, { filename: 'readme.md', fullPath: fpath });

    expect(rec.confidence).toBe(0);
  });

  it('accepts a Notion-named page, alone and in a directory', async () => {
    const name = 'Meeting Notes 0123456789abcdef0123456789abcdef.md';
    const fpath = write(name, '# Meeting Notes\n');

    const single = await new NotionFileImporter().recognize({}, { filename: name, fullPath: fpath });

    expect(single.confidence).toBeGreaterThan(0);

    write(`pages/${name}`, '# Meeting Notes\n');
    const asDir = await new NotionFileImporter().recognize(
      {},
      { filename: 'pages', fullPath: path.join(dir, 'pages') },
    );

    expect(asDir.confidence).toBeGreaterThan(0);
  });

  it('a directory of ordinary markdown is not a Notion export', async () => {
    write('docs/readme.md', '# Docs\n');
    write('docs/notes.md', '# Notes\n');

    const rec = await new NotionFileImporter().recognize(
      {},
      { filename: 'docs', fullPath: path.join(dir, 'docs') },
    );

    expect(rec.confidence).toBe(0);
  });
});

/**
 * The Google Takeout pair, both found by importing one real 2.7GB archive and
 * reading what the run said it had recognized.
 *
 * Neither is hypothetical: `withings` staged 1,661 rows of Google Fit daily
 * metrics as Withings observations (metadata and all), and `discord` claimed
 * the Google Chat folder outright. Both then appeared in the run's data sources,
 * telling the user two services had given the appliance data when neither had.
 */
const GOOGLE_FIT_DAILY_METRICS_HEADER =
  'Date,Move Minutes count,Calories (kcal),Distance (m),Heart Points,Heart Minutes,' +
  'Average heart rate (bpm),Max heart rate (bpm),Min heart rate (bpm),Low latitude (deg),' +
  'Low longitude (deg),High latitude (deg),High longitude (deg),Average speed (m/s),' +
  'Max speed (m/s),Min speed (m/s),Step count,Average weight (kg),Max weight (kg),' +
  'Min weight (kg),Inactive duration (ms),Walking duration (ms)';

describe('Withings recognizer reads columns, not substrings', () => {
  it("rejects Google Fit's daily activity metrics — THE incident", async () => {
    const fpath = write(
      'Daily activity metrics.csv',
      `${GOOGLE_FIT_DAILY_METRICS_HEADER}\n2015-05-31,,1647.55,,,,,,,,,,,,,,,,,,,\n`,
    );

    const rec = await new WithingsFileImporter().recognize(
      {},
      { filename: 'Daily activity metrics.csv', fullPath: fpath },
    );

    expect(rec.confidence).toBe(0);
  });

  it('rejects a directory holding it, which is how the Takeout was claimed', async () => {
    write('Daily activity metrics/Daily activity metrics.csv', `${GOOGLE_FIT_DAILY_METRICS_HEADER}\n`);

    const rec = await new WithingsFileImporter().recognize(
      {},
      { filename: 'Daily activity metrics', fullPath: path.join(dir, 'Daily activity metrics') },
    );

    expect(rec.confidence).toBe(0);
  });

  it('still accepts a real Withings export, whose columns ARE the measurements', async () => {
    const fpath = write(
      'withings/weight.csv',
      'Date,Weight (kg),Fat mass (kg),Bone mass (kg),Muscle mass (kg),Hydration (kg)\n' +
        '2024-01-15 08:30:00,82.5,15.1,3.2,60.0,45.3\n',
    );

    const single = await new WithingsFileImporter().recognize(
      {},
      { filename: 'weight.csv', fullPath: fpath },
    );

    expect(single.confidence).toBeGreaterThan(0.9);

    const asDir = await new WithingsFileImporter().recognize(
      {},
      { filename: 'withings', fullPath: path.join(dir, 'withings') },
    );

    expect(asDir.confidence).toBeGreaterThan(0.9);
  });
});

describe('Discord recognizer checks a directory the way it checks a file', () => {
  it('rejects Google Chat, which ships the same messages.json layout — THE incident', async () => {
    write(
      'Groups/DM 3jCTIYAAAAE/messages.json',
      JSON.stringify({
        messages: [
          {
            creator: { name: 'Steven Stone', email: 'smstone@example.com', user_type: 'Human' },
            created_date: 'Tuesday, June 4, 2013 at 1:45:49 AM UTC',
            text: 'hey',
            topic_id: 'U0SlEfc4N6U',
          },
        ],
      }),
    );
    write(
      'Groups/Space AAAA6GR04_s/messages.json',
      JSON.stringify({ messages: [{ creator: { name: 'Liam' }, created_date: 'x', text: 'hi' }] }),
    );

    const rec = await new DiscordFileImporter().recognize(
      {},
      { filename: 'Groups', fullPath: path.join(dir, 'Groups') },
    );

    expect(rec.confidence).toBe(0);
  });

  it('still accepts a real Discord package, JSON and CSV alike', async () => {
    // Written as text, not JSON.stringify: Discord's IDs are snowflakes above
    // Number.MAX_SAFE_INTEGER and ship unquoted, which is the shape the
    // recognizer has to cope with.
    write(
      'discord-json/messages/c1234567890/messages.json',
      '[{"ID": 1234567890123456789, "Timestamp": "2022-08-03 17:55:02", "Contents": "gg", "Attachments": ""}]',
    );

    const asJson = await new DiscordFileImporter().recognize(
      {},
      { filename: 'discord-json', fullPath: path.join(dir, 'discord-json') },
    );

    expect(asJson.confidence).toBeGreaterThan(0.8);

    write(
      'discord-csv/messages/c1234567890/messages.csv',
      'ID,Timestamp,Contents,Attachments\n1234567890123456789,2022-08-03 17:55:02,gg,\n',
    );

    const asCsv = await new DiscordFileImporter().recognize(
      {},
      { filename: 'discord-csv', fullPath: path.join(dir, 'discord-csv') },
    );

    expect(asCsv.confidence).toBeGreaterThan(0.8);
  });
});
