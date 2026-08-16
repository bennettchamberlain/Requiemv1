import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { CoinbaseFileImporter } from '../coinbase';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

// Coinbase has no transaction-id column. Multiple rows routinely share the
// exact same Timestamp (e.g. a buy plus its fee/convert legs, or batched
// rewards). Under the old id-less dedup these collapse on ISO(timestamp) since
// classification + filename are constant. The two rows below are byte-identical
// except for their parse order, so only the collision suffix keeps them apart.
const COLLAPSING_CSV =
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Total (inclusive of fees and/or spread),Notes\n' +
  '2023-03-02T10:00:00Z,Convert,BTC,0.01,USD,250.00,Converted\n' +
  '2023-03-02T10:00:00Z,Convert,BTC,0.01,USD,250.00,Converted\n' +
  '2023-03-02T10:00:00Z,Buy,ETH,1.5,USD,2500.00,Bought\n';

// Current Coinbase transaction-history export: a 2-line preamble before the
// real header, and the currency column renamed "Spot Price Currency" →
// "Price Currency" (plus extra Subtotal/Fees/Address columns we ignore).
const CURRENT_FORMAT_CSV =
  'Transactions\n' +
  'User,Kyle Edward Baran,63712eb7-d99a-5c1c-9f98-da63cc3c0bd2\n' +
  'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes,Sender Address,Recipient Address\n' +
  '658c98c08ecdb0b0cbdac17b,2023-12-27 21:36:00 UTC,Sell,ATOM,-461.57231,USD,$12.046,$5502.26,$5420.28,-55.58,Sold 461.57231 ATOM for 5420.28 USD,,\n';

// Write to a tmp file whose name does NOT start with "coinbase", so recognition
// is exercised via the content sniff (the real CSV exports are UUID-named).
async function withTmpFile<T>(
  content: string,
  ext: string,
  fn: (fullPath: string) => Promise<T>,
): Promise<T> {
  const tmp = path.join(os.tmpdir(), `cb-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await fs.promises.writeFile(tmp, content);
  try {
    return await fn(tmp);
  } finally {
    await fs.promises.unlink(tmp).catch(() => {});
  }
}

async function runImport(content: string, ext = '.csv'): Promise<EmittedGraph[]> {
  return withTmpFile(content, ext, async (tmp) => {
    const fi = new CoinbaseFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: path.basename(tmp), fullPath: tmp }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    return pipeline;
  });
}

async function recognizeConfidence(content: string, ext = '.csv'): Promise<number> {
  return withTmpFile(content, ext, async (tmp) => {
    const fi = new CoinbaseFileImporter();
    const rec = await fi.recognize({}, { filename: path.basename(tmp), fullPath: tmp });

    return rec.confidence;
  });
}

describe('Coinbase dedup', () => {
  it('assigns a unique, stable id to every transaction that would otherwise collapse', async () => {
    const pipeline = await runImport(COLLAPSING_CSV);
    expect(pipeline.length).toBe(3);

    const ids = pipeline.map((p) => p.item.id!);
    // (a) every id is truthy
    for (const id of ids) {
      expect(id).toBeTruthy();
    }

    // (b) ids are unique even though timestamp/filename/classification collide
    //     (and two rows are byte-identical apart from parse order)
    expect(new Set(ids).size).toBe(ids.length);

    // (c) re-import yields identical ids (idempotent)
    const again = await runImport(COLLAPSING_CSV);
    expect(again.map((p) => p.item.id!)).toEqual(ids);
  });

  it('keeps ids stable when a re-export prepends new rows', async () => {
    const ids = (await runImport(COLLAPSING_CSV)).map((p) => p.item.id!);
    const [header, ...rows] = COLLAPSING_CSV.trimEnd().split('\n');
    const reExport =
      [header, '2023-03-03T09:00:00Z,Buy,BTC,0.02,USD,500.00,Bought', ...rows].join('\n') + '\n';
    const newIds = (await runImport(reExport)).map((p) => p.item.id!);
    expect(newIds.length).toBe(ids.length + 1);
    for (const id of ids) {
      expect(newIds).toContain(id);
    }
  });

  it('carries a human Summary and no content — money movements are metadata-only', async () => {
    const pipeline = await runImport(COLLAPSING_CSV);
    const buy = pipeline.find((p) => p.item.metadata['Transaction Type'] === 'Buy');
    expect(buy).toBeTruthy();
    // titleFor reads m.Summary; there is no content row to fall back to.
    expect(buy!.item.metadata.Summary).toBe('Buy 1.5 ETH for 2500.00 USD');
    expect(buy!.item.content).toBeUndefined();
  });
});

describe('Coinbase current export format (preamble + renamed columns)', () => {
  it('recognizes the file via the header despite the leading preamble', async () => {
    // Header is on line 3, behind a "Transactions" + "User,..." preamble, and a
    // UUID-style filename gives no name-based bump — so this only passes if the
    // sniff scans past the preamble.
    expect(await recognizeConfidence(CURRENT_FORMAT_CSV)).toBe(0.95);
  });

  it('parses transactions despite the preamble and the renamed currency column', async () => {
    const pipeline = await runImport(CURRENT_FORMAT_CSV);
    expect(pipeline.length).toBe(1);

    const m = pipeline[0].item.metadata;
    expect(pipeline[0].item.classification).toBe('sale');
    expect(m['Transaction Type']).toBe('Sell');
    expect(m.Asset).toBe('ATOM');
    // Currency comes from the renamed "Price Currency" column.
    expect(m['Spot Price Currency']).toBe('USD');
    expect(m.Summary).toBe('Sell -461.57231 ATOM for $5420.28 USD');
    // Timestamp parsed (not dropped), so the item is placed on the timeline.
    expect(pipeline[0].item.timestamp instanceof Date).toBe(true);
    expect(isNaN(pipeline[0].item.timestamp!.getTime())).toBe(false);
  });

  it('produces no rows for a CSV with no recognizable header (e.g. gain/loss report)', async () => {
    const gainLoss =
      'Gain/loss report\n' +
      'User,63712eb7,foo@example.com\n' +
      'Transaction Type,Transaction ID,Tax lot ID,Asset name,Amount,Date Acquired,Cost basis (USD)\n' +
      'Sell,abc,lot1,BTC,0.5,2021-01-01,1000\n';
    expect(await runImport(gainLoss)).toEqual([]);
  });
});

// Trimmed-down shape of the JSON privacy export (coinbase_data.json). Records
// mirror real ones: descriptive Notes, a terse "Earn Task" note, and a
// note-less transfer. Non-transaction sections must not produce items.
const JSON_EXPORT = JSON.stringify({
  'Financial Data': {
    'Bank accounts': [
      { Account_type: 'savings', Bank_name: 'ALLY BANK', Customer_name: 'Kyle Baran', Verified: true },
    ],
    'Coinbase transaction history': [
      {
        Account_name: 'ATOM Wallet',
        Amount: '-461.57231',
        Balance: '0.0',
        Currency: 'ATOM',
        Crypto_hash: null,
        Notes: 'Sold 461.57231 ATOM for 5420.28 USD',
        Timestamp: '2023-12-27 21:36:00 UTC',
        To: null,
        Transfer_total_fee: 0.0,
      },
      {
        Account_name: '00 Wallet',
        Amount: '1.055576080000',
        Balance: '1.05557608',
        Currency: '00',
        Crypto_hash: null,
        Notes: 'Earn Task',
        Timestamp: '2022-10-12 23:41:52 UTC',
        To: null,
        Transfer_total_fee: 0.0,
      },
      {
        Account_name: 'BTC Wallet',
        Amount: '0.00422256',
        Balance: '0.00422256',
        Currency: 'BTC',
        Crypto_hash: 'abc123',
        Notes: null,
        Timestamp: '2022-11-01 10:00:00 UTC',
        To: '63291443fde3a200bbf3e9a3',
        Transfer_total_fee: 0.0,
      },
    ],
    'Section description': 'These are your financial accounts & transactions',
  },
  Identity: { 'Section description': 'This is your identity data' },
  'Personal Details': { Emails: 'someone@example.com' },
});

describe('Coinbase JSON privacy export', () => {
  it('recognizes the file by content even under a non-coinbase name', async () => {
    expect(await recognizeConfidence(JSON_EXPORT, '.json')).toBe(0.95);
  });

  it('gives an unrecognized coinbase-named JSON only the name bump', async () => {
    return withTmpFile('{"foo": 1}', '.json', async (tmp) => {
      const renamed = path.join(path.dirname(tmp), 'coinbase_data.json');
      await fs.promises.rename(tmp, renamed);
      try {
        const fi = new CoinbaseFileImporter();
        const rec = await fi.recognize({}, { filename: path.basename(renamed), fullPath: renamed });
        expect(rec.confidence).toBe(0.5);
      } finally {
        await fs.promises.unlink(renamed).catch(() => {});
      }
    });
  });

  it('does not recognize unrelated JSON', async () => {
    expect(await recognizeConfidence('{"foo": [1,2,3]}', '.json')).toBe(0);
  });

  it('imports only the transaction history, with human summaries', async () => {
    const pipeline = await runImport(JSON_EXPORT, '.json');
    // 3 transactions — bank accounts / identity / personal details never
    // become items.
    expect(pipeline.length).toBe(3);

    const [sold, earn, transfer] = pipeline.map((p) => p.item);
    // Descriptive Notes are used verbatim as the summary.
    expect(sold.metadata.Summary).toBe('Sold 461.57231 ATOM for 5420.28 USD');
    // Terse notes get the movement appended.
    expect(earn.metadata.Summary).toBe('Earn Task (Received 1.055576080000 00)');
    // Note-less records fall back to a Sent/Received line.
    expect(transfer.metadata.Summary).toBe('Received 0.00422256 BTC');

    // Event type per kind: the sale is a sale, the on-chain receive a
    // transfer, and the earn reward is income — a credit.
    expect(sold.classification).toBe('sale');
    expect(earn.classification).toBe('credit');
    expect(transfer.classification).toBe('transfer');

    for (const item of [sold, earn, transfer]) {
      expect(item.timestamp instanceof Date).toBe(true);
      expect(isNaN(item.timestamp!.getTime())).toBe(false);
      expect(item.metadata.Source).toBe('Coinbase');
    }

    expect(sold.timestamp!.toISOString()).toBe('2023-12-27T21:36:00.000Z');
    expect(transfer.metadata['Crypto Hash']).toBe('abc123');
    expect(transfer.metadata.To).toBe('63291443fde3a200bbf3e9a3');
    expect(earn.metadata.Account).toBe('00 Wallet');
    expect(earn.metadata.Balance).toBe('1.05557608');
  });

  it('assigns unique, stable ids', async () => {
    const pipeline = await runImport(JSON_EXPORT, '.json');
    const ids = pipeline.map((p) => p.item.id!);
    for (const id of ids) {
      expect(id).toBeTruthy();
    }

    expect(new Set(ids).size).toBe(ids.length);
    const again = await runImport(JSON_EXPORT, '.json');
    expect(again.map((p) => p.item.id!)).toEqual(ids);
  });

  it('keeps ids stable when a re-export shifts rows down (no positional id component)', async () => {
    const ids = (await runImport(JSON_EXPORT, '.json')).map((p) => p.item.id!);

    // Simulate a newer export: a fresh transaction lands at the top, bumping
    // every original record down a row. All original ids must survive so the
    // re-import dedups instead of duplicating the whole history.
    const reExport = JSON.parse(JSON_EXPORT);
    reExport['Financial Data']['Coinbase transaction history'].unshift({
      Account_name: 'ETH Wallet',
      Amount: '0.5',
      Balance: '0.5',
      Currency: 'ETH',
      Notes: 'Bought 0.5 ETH for $1,000.00 USD.',
      Timestamp: '2024-01-01 00:00:00 UTC',
    });
    const newIds = (await runImport(JSON.stringify(reExport), '.json')).map((p) => p.item.id!);

    expect(newIds.length).toBe(ids.length + 1);
    for (const id of ids) {
      expect(newIds).toContain(id);
    }
  });

  it('separates same-timestamp identical rows only via the collision suffix', async () => {
    // Two byte-identical records (same second, same amount, same balance) —
    // the collision safety net must keep them distinct.
    const twin = {
      Account_name: 'ATOM Wallet',
      Amount: '0.58',
      Balance: '0.0158',
      Currency: 'ATOM',
      Notes: null,
      Timestamp: '2023-07-19 19:19:48 UTC',
    };
    const doc = JSON.stringify({ 'Financial Data': { 'Coinbase transaction history': [twin, { ...twin }] } });
    const ids = (await runImport(doc, '.json')).map((p) => p.item.id!);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('classifies buys, converts, and bank on/off-ramps', async () => {
    const doc = JSON.stringify({
      'Financial Data': {
        'Coinbase transaction history': [
          {
            Account_name: 'BTC Wallet',
            Amount: '0.004',
            Balance: '0.005',
            Currency: 'BTC',
            Notes: 'Bought 0.004 BTC for $200.00 USD.',
            Timestamp: '2021-12-31 23:20:45 UTC',
            Transfer_payment_method: 'JPMORGAN CHASE',
          },
          {
            Account_name: 'ATOM Wallet',
            Amount: '0.13093',
            Balance: '0.13093',
            Currency: 'ATOM',
            Notes: 'Converted 0.00130234 ETH to 0.13093 ATOM.',
            Timestamp: '2022-09-03 00:00:44 UTC',
          },
          {
            Account_name: 'Cash (USD)',
            Amount: '-5420.38',
            Balance: '0.0',
            Currency: 'USD',
            Notes: null,
            Timestamp: '2023-12-27 21:37:02 UTC',
            Transfer_payment_method: 'JPMORGAN CHASE',
          },
          {
            Account_name: 'ATOM Wallet',
            Amount: '0.58',
            Balance: '0.0158',
            Currency: 'ATOM',
            Notes: null,
            Timestamp: '2023-07-19 19:19:48 UTC',
          },
        ],
      },
    });
    const kinds = (await runImport(doc, '.json')).map((p) => p.item.classification);
    expect(kinds).toEqual([
      'payment', // Bought… (payment method must not override the note)
      'conversion', // Converted…
      'transfer', // note-less bank off-ramp
      'credit', // note-less unpaired credit — reward income
    ]);
  });

  it('merges the two legs of a trade into one event with counterpart metadata', async () => {
    const doc = JSON.stringify({
      'Financial Data': {
        'Coinbase transaction history': [
          {
            Account_name: 'Cash (USD)',
            Amount: '8.230000000000',
            Balance: '0.00000823',
            Currency: 'USD',
            Notes: 'Sold 32.61764376 ZETACHAIN for 8.23 USD',
            Timestamp: '2025-04-02 19:02:24 UTC',
          },
          {
            Account_name: 'ZETACHAIN Wallet',
            Amount: '-32.617643760000',
            Balance: '0.0',
            Currency: 'ZETACHAIN',
            Notes: 'Sold 32.61764376 ZETACHAIN for 8.23 USD',
            Timestamp: '2025-04-02 19:02:24 UTC',
          },
        ],
      },
    });
    const pipeline = await runImport(doc, '.json');
    expect(pipeline.length).toBe(1);
    const m = pipeline[0].item.metadata;
    // A sale anchors on the asset leaving; the cash leg rides as counterpart.
    expect(pipeline[0].item.classification).toBe('sale');
    expect(m.Account).toBe('ZETACHAIN Wallet');
    expect(m.Amount).toBe('-32.617643760000');
    expect(m['Counterpart Account']).toBe('Cash (USD)');
    expect(m['Counterpart Amount']).toBe('8.230000000000');
    expect(m['Counterpart Currency']).toBe('USD');
    expect(m.Summary).toBe('Sold 32.61764376 ZETACHAIN for 8.23 USD');
  });

  it('pairs uncaptioned same-second cash-debit/asset-credit legs into one buy', async () => {
    const doc = JSON.stringify({
      'Financial Data': {
        'Coinbase transaction history': [
          {
            Account_name: 'ATOM Wallet',
            Amount: '0.580000000000',
            Balance: '0.0158',
            Currency: 'ATOM',
            Notes: null,
            Timestamp: '2023-07-19 19:17:46 UTC',
          },
          {
            Account_name: 'Cash (USD)',
            Amount: '-4.660000000000',
            Balance: '5.34',
            Currency: 'USD',
            Notes: null,
            Timestamp: '2023-07-19 19:17:46 UTC',
          },
        ],
      },
    });
    const pipeline = await runImport(doc, '.json');
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.classification).toBe('payment');
    expect(pipeline[0].item.metadata.Summary).toBe('Bought 0.58 ATOM for 4.66 USD');
    expect(pipeline[0].item.metadata['Counterpart Account']).toBe('Cash (USD)');
  });

  it('pairs trade legs stamped up to 2 seconds apart (object-id note is not a caption)', async () => {
    // Mirrors a real export shape: a BTC debit whose Notes is a bare order id,
    // settling one second after its cash credit.
    const doc = JSON.stringify({
      'Financial Data': {
        'Coinbase transaction history': [
          {
            Account_name: 'Cash (USD)',
            Amount: '1463.850000000000',
            Balance: '1463.85',
            Currency: 'USD',
            Notes: null,
            Timestamp: '2021-10-05 01:26:53 UTC',
            Transfer_id: '615ba94ce766850951f2e85c',
          },
          {
            Account_name: 'BTC Wallet',
            Amount: '-0.029510000000',
            Balance: '0.0',
            Currency: 'BTC',
            Notes: '615ba94de766850951f2e86e',
            Timestamp: '2021-10-05 01:26:54 UTC',
          },
        ],
      },
    });
    const pipeline = await runImport(doc, '.json');
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.classification).toBe('sale');
    expect(pipeline[0].item.metadata.Summary).toBe('Sold 0.02951 BTC for 1463.85 USD');
    expect(pipeline[0].item.metadata.Account).toBe('BTC Wallet');
    expect(pipeline[0].item.metadata['Counterpart Amount']).toBe('1463.850000000000');
  });

  it('does not pair legs more than 2 seconds apart', async () => {
    const doc = JSON.stringify({
      'Financial Data': {
        'Coinbase transaction history': [
          {
            Account_name: 'Cash (USD)',
            Amount: '-9.670000000000',
            Balance: '0.0',
            Currency: 'USD',
            Notes: null,
            Timestamp: '2025-04-02 19:03:13 UTC',
          },
          {
            Account_name: 'ZETACHAIN Wallet',
            Amount: '9.780000000000',
            Balance: '9.78',
            Currency: 'ZETACHAIN',
            Notes: null,
            Timestamp: '2025-04-02 19:03:16 UTC',
          },
        ],
      },
    });
    const kinds = (await runImport(doc, '.json')).map((p) => p.item.classification);
    // 3s apart: the debit stays unexplained, the credit reads as income.
    expect(kinds.sort()).toEqual(['credit', 'transaction']);
  });

  it('treats equal-and-opposite cross-currency pairs (staking wraps) as moves, not credits', async () => {
    const doc = JSON.stringify({
      'Financial Data': {
        'Coinbase transaction history': [
          {
            Account_name: 'ETH Wallet',
            Amount: '0.416903030000',
            Balance: '0.41690303',
            Currency: 'ETH',
            Notes: null,
            Timestamp: '2023-04-26 20:00:10 UTC',
          },
          {
            Account_name: 'ETH2 Wallet',
            Amount: '-0.416903030000',
            Balance: '0.0',
            Currency: 'ETH2',
            Notes: null,
            Timestamp: '2023-04-26 20:00:10 UTC',
          },
        ],
      },
    });
    const kinds = (await runImport(doc, '.json')).map((p) => p.item.classification);
    // Neither leg is income (no 'credit') — both stay generic.
    expect(kinds).toEqual(['transaction', 'transaction']);
  });

  it('imports nothing (and does not throw) when the history section is missing', async () => {
    const noHistory = JSON.stringify({ 'Financial Data': { 'Bank accounts': [] } });
    expect(await runImport(noHistory, '.json')).toEqual([]);
  });
});
