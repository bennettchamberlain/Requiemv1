import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CalendarFileImporter } from '../calendar';
import { GmailFileImporter } from '../gmail';
import { GoogleVoiceFileImporter } from '../googlevoice';
import type { DirEntry } from '../registry';
import type { Graph, ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

function makeParams() {
  const collected: EmittedGraph[] = [];

  return {
    params: { timeframe: undefined, pipeline: { push: (g: Graph) => collected.push(g as EmittedGraph) } },
    collected,
  };
}

describe('Calendar / GoogleVoice / Gmail datasources', () => {
  it('imports simple VEVENT from .ics', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ics-'));
    const file = path.join(tmp, 'events.ics');
    fs.writeFileSync(
      file,
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:abc123\nDTSTART:20240102T030405Z\nDTEND:20240102T040405Z\nSUMMARY:Meeting\nDESCRIPTION:Discuss stuff\nEND:VEVENT\nEND:VCALENDAR\n',
    );
    const imp = new CalendarFileImporter();
    const rec = await imp.recognize(undefined, { fullPath: file } as DirEntry);
    expect(rec.confidence).toBeGreaterThan(0.5);
    const { params, collected } = makeParams();
    await imp.fileImport(undefined, { fullPath: file } as DirEntry, params as unknown as ImportParams);
    expect(collected.length).toBe(1);
    expect(collected[0].item.classification).toBe('event');
  });

  it('parses simple Google Voice HTML message', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gvoice-'));
    const callsDir = path.join(tmp, 'Calls');
    fs.mkdirSync(callsDir);
    const file = path.join(callsDir, 'conv.html');
    fs.writeFileSync(
      file,
      '<div class="message"><cite class="sender"><span class="fn">Alice</span><a class="tel" href="tel:+123"></a></cite><span class="dt" title="2024-01-02T03:04:05Z"></span><q>Hello</q></div>',
    );
    const imp = new GoogleVoiceFileImporter();
    const rec = await imp.recognize(undefined, { fullPath: tmp } as DirEntry);
    expect(rec.confidence).toBeGreaterThan(0.5);
    const { params, collected } = makeParams();
    await imp.fileImport(undefined, { fullPath: tmp } as DirEntry, params as unknown as ImportParams);
    const items = collected.filter((c: EmittedGraph) => c.item);
    const entities = collected.filter((c: EmittedGraph) => c.entity);
    expect(items.length).toBe(1);
    expect(items[0].item.metadata.Source).toBe('GoogleVoice');
    expect(items[0].item.metadata.Sender).toBe('Alice');
    expect(entities.length).toBe(1); // sender emitted as a contact entity
    expect(entities[0].entity!.attributes![0]!.value).toBe('+123');
  });

  it('parses minimal Gmail mbox', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gmail-'));
    const file = path.join(tmp, 'mail.mbox');
    fs.writeFileSync(
      file,
      'From someone@example.com Sat Jan 01 00:00:00 2024\nDate: Sat, 01 Jan 2024 00:00:00 +0000\nFrom: Someone <someone@example.com>\nSubject: Test Mail\n\nBody here\n',
    );
    const imp = new GmailFileImporter();
    const rec = await imp.recognize(undefined, { fullPath: file } as DirEntry);
    expect(rec.confidence).toBeGreaterThan(0.5);
    const { params, collected } = makeParams();
    await imp.fileImport(undefined, { fullPath: file } as DirEntry, params as unknown as ImportParams);
    const items = collected.filter((c) => c.item);
    expect(items.length).toBe(1);
    expect(items[0].item.metadata.Subject).toBe('Test Mail');
  });
});
