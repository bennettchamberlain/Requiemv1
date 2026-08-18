import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { PayPalFileImporter } from '../paypal';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

// Two completed transactions that would collapse under the old id-less dedup:
// same Date with a blank Time column (so parsePayPalDate yields midnight for both),
// constant classification + filename. Distinct Transaction IDs keep them apart.
const COLLAPSING_CSV =
  '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"\n' +
  '"01/15/2023","","Jane Doe","Payment","Completed","USD","-24.50","0.00","-24.50","TXN0000000000000001"\n' +
  '"01/15/2023","","John Smith","Payment","Completed","USD","-10.00","0.00","-10.00","TXN0000000000000002"\n';

async function runImport(csv: string): Promise<EmittedGraph[]> {
  const tmp = path.join(os.tmpdir(), `paypal-dedup-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await fs.promises.writeFile(tmp, csv);
  try {
    const fi = new PayPalFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: path.basename(tmp), fullPath: tmp }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    return pipeline;
  } finally {
    await fs.promises.unlink(tmp).catch(() => {});
  }
}

describe('PayPal dedup', () => {
  it('assigns a unique, stable id to every transaction that would otherwise collapse', async () => {
    const pipeline = await runImport(COLLAPSING_CSV);
    expect(pipeline.length).toBe(2);

    const ids = pipeline.map((p) => p.item.id!);
    // (a) every id is truthy
    for (const id of ids) {
      expect(id).toBeTruthy();
    }

    // (b) ids are unique even though timestamp/filename/classification collide
    expect(new Set(ids).size).toBe(ids.length);

    // (c) re-import yields identical ids (idempotent)
    const again = await runImport(COLLAPSING_CSV);
    expect(again.map((p) => p.item.id!)).toEqual(ids);
  });

  it('sets a title-bearing key so Name-less transactions never title as the bare filename', async () => {
    const csv =
      '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"\n' +
      '"01/15/2023","","Jane Doe","Payment","Completed","USD","-24.50","0.00","-24.50","TXN0000000000000001"\n' +
      '"01/16/2023","","","General Withdrawal","Completed","USD","-10.00","0.00","-10.00","TXN0000000000000002"\n';
    const pipeline = await runImport(csv);
    expect(pipeline.length).toBe(2);
    // Named row keeps its counterparty as the title source.
    expect(pipeline[0].item.metadata.Title).toBe('Jane Doe');
    // Name-less row titles from its Type rather than a filename fallback.
    expect(pipeline[1].item.metadata.Name).toBeUndefined();
    expect(pipeline[1].item.metadata.Title).toBe('General Withdrawal');
  });

  it('reads amounts from the Amount/Fees/Total statement dialect', async () => {
    const csv =
      '"Date","Time","TimeZone","Name","Type","Status","Currency","Amount","Fees","Total","Transaction ID"\n' +
      '"07/14/2025","11:12:01","PDT","dQ&A Market Research","Mass Pay Payment","Completed","USD","15.00","0.00","15.00","TXN0000000000000001"\n';
    const pipeline = await runImport(csv);
    expect(pipeline.length).toBe(1);
    const meta = pipeline[0].item.metadata;
    expect(meta.Gross).toBe('15.00');
    expect(meta.Fee).toBe('0.00');
    expect(meta.Net).toBe('15.00');
  });

  it('creates event-only items with no content payload', async () => {
    const pipeline = await runImport(COLLAPSING_CSV);
    for (const p of pipeline) {
      expect(p.item.content).toBeUndefined();
    }
  });

  it('classifies rows by direction: withdrawal / credit / payment / transaction', async () => {
    const csv =
      '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"\n' +
      '"01/15/2023","10:00:00","","User Initiated Withdrawal","Completed","USD","-15.00","0.00","-15.00","TX1"\n' +
      '"01/16/2023","10:00:00","dQ&A","Mass Pay Payment","Completed","USD","15.00","0.00","15.00","TX2"\n' +
      '"01/17/2023","10:00:00","Store","Express Checkout Payment","Completed","USD","-24.50","0.00","-24.50","TX3"\n' +
      '"01/18/2023","10:00:00","","General Card Deposit","Completed","USD","40.00","0.00","40.00","TX4"\n';
    const pipeline = await runImport(csv);
    const byId = Object.fromEntries(
      pipeline.map((p) => [p.item.metadata['Transaction ID'], p.item.classification]),
    );
    expect(byId).toEqual({
      TX1: 'withdrawal', // fuzzy 'withdrawal' in Type, regardless of sign
      TX2: 'credit', // 'Payment' in Type + positive amount = money arriving
      TX3: 'payment', // negative, not a withdrawal, not an inbound payment
      TX4: 'transaction', // positive non-payment (lone deposit) keeps the generic kind
    });
  });

  it('skips currency conversions — both legs restate a payment already imported', async () => {
    const csv =
      '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"\n' +
      '"01/15/2023","10:00:00","Just Eat","Express Checkout Payment","Completed","EUR","-9.99","0.00","-9.99","TX1"\n' +
      '"01/15/2023","10:00:00","","General Currency Conversion","Completed","EUR","9.99","0.00","9.99","TX2"\n' +
      '"01/15/2023","10:00:00","","General Currency Conversion","Completed","USD","-11.17","0.00","-11.17","TX3"\n';
    const pipeline = await runImport(csv);
    expect(pipeline.map((p) => p.item.metadata['Transaction ID'])).toEqual(['TX1']);
  });

  it('skips authorizations — bookkeeping riding along with the real payment', async () => {
    const csv =
      '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"\n' +
      '"01/15/2023","10:00:00","USPS","General Authorization","Completed","USD","-4.44","0.00","-4.44","TX1"\n' +
      '"01/15/2023","10:00:01","USPS","Express Checkout Payment","Completed","USD","-4.44","0.00","-4.44","TX2"\n';
    const pipeline = await runImport(csv);
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.metadata['Transaction ID']).toBe('TX2');
  });

  it('suppresses a card deposit that funds a near-simultaneous payment, keeps a lone one', async () => {
    const csv =
      '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"\n' +
      '"01/15/2023","10:00:00","Store","Express Checkout Payment","Completed","USD","-250.00","0.00","-250.00","TX1"\n' +
      '"01/15/2023","10:00:00","","General Card Deposit","Completed","USD","250.00","0.00","250.00","TX2"\n' +
      '"02/20/2023","10:00:00","","General Card Deposit","Completed","USD","40.00","0.00","40.00","TX3"\n';
    const pipeline = await runImport(csv);
    const ids = pipeline.map((p) => p.item.metadata['Transaction ID']);
    expect(ids).toEqual(['TX1', 'TX3']);
    // The surviving deposit is not a payment or withdrawal: generic kind.
    expect(pipeline[1].item.classification).toBe('transaction');
  });

  it('falls back to a composite key when the Transaction ID column is absent', async () => {
    const csv =
      '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net"\n' +
      '"01/15/2023","","Jane Doe","Payment","Completed","USD","-24.50","0.00","-24.50"\n' +
      '"01/15/2023","","John Smith","Payment","Completed","USD","-10.00","0.00","-10.00"\n';
    const pipeline = await runImport(csv);
    expect(pipeline.length).toBe(2);
    const ids = pipeline.map((p) => p.item.id!);
    for (const id of ids) {
      expect(id).toBeTruthy();
    }

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('PayPal recognize()', () => {
  const HEADER_CSV =
    '"Date","Time","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID"\n' +
    '"01/15/2023","10:00:00","Jane Doe","Payment","Completed","USD","-24.50","0.00","-24.50","TXN1"\n';
  // Same shape of data, but without the '"Date"'/'"Transaction ID"' quoted
  // header cells the sniffer looks for (e.g. an already-reformatted export).
  const NON_MATCHING_CSV = 'Date,Time,Name,Amount\n01/15/2023,10:00:00,Jane Doe,-24.50\n';

  async function withTempFile(
    name: string,
    content: string,
    fn: (fpath: string) => Promise<void>,
  ): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recognize-'));
    const fpath = path.join(dir, name);
    await fs.promises.writeFile(fpath, content);
    try {
      await fn(fpath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('gives high confidence when the CSV header carries the PayPal signature ("Date" + "Transaction ID")', async () => {
    await withTempFile('statement.csv', HEADER_CSV, async (fpath) => {
      const fi = new PayPalFileImporter();
      const rec = await fi.recognize({}, { filename: 'statement.csv', fullPath: fpath });
      expect(rec.confidence).toBe(0.9);
    });
  });

  it('falls back to a moderate 0.5 confidence for "download.csv" whose header does not match', async () => {
    await withTempFile('download.csv', NON_MATCHING_CSV, async (fpath) => {
      const fi = new PayPalFileImporter();
      const rec = await fi.recognize({}, { filename: 'download.csv', fullPath: fpath });
      expect(rec.confidence).toBe(0.5);
    });
  });

  it('falls back to a moderate 0.5 confidence for a "paypal*.csv" filename whose header does not match', async () => {
    await withTempFile('paypal_export_2024.csv', NON_MATCHING_CSV, async (fpath) => {
      const fi = new PayPalFileImporter();
      const rec = await fi.recognize({}, { filename: 'paypal_export_2024.csv', fullPath: fpath });
      expect(rec.confidence).toBe(0.5);
    });
  });

  it('gives zero confidence to an unrelated CSV whose name and header both miss', async () => {
    await withTempFile('transactions.csv', NON_MATCHING_CSV, async (fpath) => {
      const fi = new PayPalFileImporter();
      const rec = await fi.recognize({}, { filename: 'transactions.csv', fullPath: fpath });
      expect(rec.confidence).toBe(0);
    });
  });

  it('gives zero confidence to a non-.csv file even if it is named like a PayPal export', async () => {
    await withTempFile('paypal_export.txt', HEADER_CSV, async (fpath) => {
      const fi = new PayPalFileImporter();
      const rec = await fi.recognize({}, { filename: 'paypal_export.txt', fullPath: fpath });
      expect(rec.confidence).toBe(0);
    });
  });

  it('recognizes a directory by scanning its CSVs for a matching header', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recognize-dir-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'unrelated.csv'), NON_MATCHING_CSV);
      await fs.promises.writeFile(path.join(dir, 'statement.csv'), HEADER_CSV);
      const fi = new PayPalFileImporter();
      const rec = await fi.recognize({}, { filename: path.basename(dir), fullPath: dir });
      expect(rec.confidence).toBe(0.9);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives a directory with no matching CSV a low dir_threshold instead of a false match', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paypal-recognize-dir-'));
    try {
      await fs.promises.writeFile(path.join(dir, 'unrelated.csv'), NON_MATCHING_CSV);
      const fi = new PayPalFileImporter();
      const rec = await fi.recognize({}, { filename: path.basename(dir), fullPath: dir });
      expect(rec.confidence).toBe(0);
      expect(rec.dir_threshold).toBe(0.7);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
