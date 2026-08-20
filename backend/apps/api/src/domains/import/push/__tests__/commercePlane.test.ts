import type { StagedItem } from '../../entities/StagedItemEntity';
import {
  backfillEntityTypesFor,
  destinationsFor,
  edgeProjectionSourcesFor,
  isDigitalGood,
  toCanonical,
  type CanonicalRecord,
} from '../canonical';
import {
  PRODUCT_MODEL_SOURCE_SYSTEM,
  toObservationInput,
  toProductModelInput,
  toReceiptInput,
  toReceiptLineItemInputs,
} from '../inputs';

/**
 * The commerce plane: a purchase becoming a receipt, a catalogue entry and a
 * sighting.
 *
 * The invariant the whole feature rests on is that a purchase ALWAYS produces a
 * receipt. The receipt is what carries the merchant, the money and the moment —
 * an object row alone cannot answer "where did I buy this?", and before this
 * a subscription fee pushed NOWHERE and its spend was invisible.
 */

function stagedRow(overrides: Partial<StagedItem> = {}): StagedItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    dataSource: 'amazon',
    classification: 'purchase',
    contentHash: 'hash-1',
    occurredAt: new Date('2024-03-02T10:00:00Z'),
    timespanEnd: null,
    latitude: null,
    longitude: null,
    filename: null,
    mediaType: null,
    originalLocation: null,
    intermediateLocation: null,
    metadata: {},
    createdAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  } as StagedItem;
}

function recordFor(overrides: Partial<StagedItem> = {}): CanonicalRecord {
  return toCanonical(stagedRow(overrides));
}

describe('isDigitalGood evidence order', () => {
  it('lets an explicit declaration outrank every guess, in BOTH directions', () => {
    // The bug this ordering exists to prevent: with the category guess first,
    // an explicit `Digital: false` on a row categorised "Subscription" was
    // overridden, moving a physical good out of ci.objects and into
    // ci.content on the next push — with no migration to undo it.
    expect(isDigitalGood(recordFor({ metadata: { IsDigital: false, Category: 'Subscription Box' } }))).toBe(
      false,
    );
    expect(isDigitalGood(recordFor({ metadata: { Digital: 'false', Product: 'Kindle Paperwhite' } }))).toBe(
      false,
    );
    expect(isDigitalGood(recordFor({ metadata: { IsDigital: true, Product: 'Cast Iron Pan' } }))).toBe(true);
  });

  it('prefers IsDigital over the legacy Digital when both are stated', () => {
    expect(isDigitalGood(recordFor({ metadata: { IsDigital: true, Digital: false } }))).toBe(true);
  });

  it('reads a stated digital category next', () => {
    expect(isDigitalGood(recordFor({ metadata: { Category: 'DIGITAL_VIDEO_DOWNLOAD' } }))).toBe(true);
    expect(isDigitalGood(recordFor({ metadata: { 'Product Type': 'Mobile Application' } }))).toBe(true);
  });

  it('does not read a payment processor’s transaction Type as a product category', () => {
    // `Type` is PayPal's and Venmo's generic transaction type, and it used to
    // be the last entry of the CATEGORY chain (inherited from
    // toThingInput's inline chain). `DIGITAL_CATEGORY_RE` matched
    // 'Subscription Payment' through it, so a cast-iron pan bought with a
    // recurring PayPal payment was declared a digital good and routed to
    // ci.content instead of ci.objects — an object moved out of the things
    // table by a payment method.
    const paidBySubscription = recordFor({
      dataSource: 'paypal',
      metadata: { Product: 'Cast Iron Pan', Type: 'Subscription Payment', Total: '42.50' },
    });

    expect(isDigitalGood(paidBySubscription)).toBe(false);
    expect(destinationsFor(paidBySubscription)).toEqual(['receipts', 'things']);
    // A REAL product taxonomy still routes it, under the keys that mean one.
    expect(isDigitalGood(recordFor({ metadata: { 'Product Category': 'Subscription' } }))).toBe(true);
  });

  it('keeps the category pattern narrow enough not to swallow real objects', () => {
    // Amazon files a physical CD under ABIS_MUSIC and a board game under
    // TOYS_AND_GAMES. A looser pattern sends real things to ci.content and
    // loses them from the things plane — the same failure, inverted.
    expect(isDigitalGood(recordFor({ metadata: { Category: 'ABIS_MUSIC', Product: 'Blue Train' } }))).toBe(
      false,
    );
    expect(isDigitalGood(recordFor({ metadata: { Category: 'TOYS_AND_GAMES', Product: 'Catan' } }))).toBe(
      false,
    );
    expect(isDigitalGood(recordFor({ metadata: { Category: 'ELECTRONIC_CABLE', Product: 'USB-C' } }))).toBe(
      false,
    );
  });

  it('reads a digital-only merchant third', () => {
    // "Portal 2" matches no keyword; Steam sells nothing physical.
    expect(isDigitalGood(recordFor({ metadata: { Merchant: 'Steam', Product: 'Portal 2' } }))).toBe(true);
  });

  it('falls back to the product name, as it always did', () => {
    expect(isDigitalGood(recordFor({ metadata: { Product: 'Some Title [Digital Code]' } }))).toBe(true);
    expect(isDigitalGood(recordFor({ metadata: { Product: 'Cast Iron Pan' } }))).toBe(false);
  });
});

describe('destinationsFor, commerce plane', () => {
  it('always gives a purchase a receipt beside the good', () => {
    expect(destinationsFor(recordFor({ metadata: { Product: 'Cast Iron Pan' } }))).toEqual([
      'receipts',
      'things',
    ]);
  });

  it('adds an observation for an identified physical good', () => {
    const rec = recordFor({
      metadata: { Product: 'Some Book', Identifiers: [{ namespace: 'isbn', value: '0306406152' }] },
    });

    // `product_models` FIRST: the catalogue row is the identity the receipt
    // line resolves against, and this list has to stay a subsequence of
    // PushStage.DESTINATION_ORDER.
    expect(destinationsFor(rec)).toEqual(['product_models', 'receipts', 'things', 'observations']);
  });

  it('mints a catalogue entry off the identifier, whatever the kind', () => {
    // A Goodreads book is a reading ANNOTATION, not a purchase — minting the
    // catalogue entry is a property of the identifier, not of the kind.
    const book = recordFor({
      dataSource: 'goodreads',
      classification: 'annotation',
      metadata: { Title: 'Fahrenheit 451', Identifiers: [{ namespace: 'isbn', value: '9781451673319' }] },
    });

    expect(destinationsFor(book)).toEqual(['product_models', 'content']);
  });

  it('mints nothing catalogue-shaped from a retailer-scoped identifier', () => {
    // A SKU is unique inside one shop; a catalogue keyed on one collides across
    // shops and the claim index is first-writer-wins, so the mistake is
    // permanent.
    const rec = recordFor({
      metadata: { Product: 'Widget', Identifiers: [{ namespace: 'sku', value: 'WID-1' }] },
    });

    expect(destinationsFor(rec)).toEqual(['receipts', 'things']);
  });

  it('routes a detected receipt email to receipts alone when the mail gate had rejected it', () => {
    const rescued = recordFor({ dataSource: 'gmail', classification: 'receipt', metadata: {} });

    expect(destinationsFor(rescued)).toEqual(['receipts']);
  });

  it('keeps the communications home for a receipt the mail gate had passed', () => {
    // The receipt lane must only ever ADD. Reclassifying an order confirmation
    // that Gmail filed under Category Personal would otherwise REMOVE it from
    // ci.communications, where it lands today.
    const kept = recordFor({
      dataSource: 'gmail',
      classification: 'receipt',
      metadata: { HumanCorrespondence: true },
    });

    expect(destinationsFor(kept)).toEqual(['communications', 'receipts']);
  });

  it('makes an itemised money movement a receipt as well as an event', () => {
    const order = recordFor({
      dataSource: 'uber',
      classification: 'transaction',
      metadata: { Merchant: 'Chez X', LineItems: [{ Product: 'Ramen', Total: 14 }] },
    });

    expect(destinationsFor(order)).toEqual(['events', 'receipts']);
  });

  it('leaves an un-itemised money movement on events alone', () => {
    expect(destinationsFor(recordFor({ classification: 'transaction', metadata: {} }))).toEqual(['events']);
  });
});

describe('the sweep vocabularies stay in step with the new destinations', () => {
  it('maps the commerce destinations onto their backfill entity types', () => {
    expect(backfillEntityTypesFor(['receipts', 'product_models', 'observations'])).toEqual([
      'product',
      'receipt',
    ]);
  });

  it('maps them onto the edge-projection sources the matrix actually has', () => {
    // `product_models` has no rule in the deterministic-edge matrix, so asking
    // for a leg would be a sweep that can only find zero candidates.
    expect(edgeProjectionSourcesFor(['receipts', 'observations', 'product_models'])).toEqual([
      'receipts',
      'observations',
    ]);
  });
});

describe('toReceiptLineItemInputs', () => {
  it('makes a bare purchase its own single line', () => {
    const lines = toReceiptLineItemInputs(
      recordFor({ metadata: { Product: 'Cast Iron Pan', Total: '42.50', Currency: 'USD', Quantity: 1 } }),
    );

    expect(lines).toEqual([
      {
        lineNumber: 1,
        description: 'Cast Iron Pan',
        isPhysical: true,
        quantity: 1,
        currency: 'USD',
        totalPriceMinor: 4250,
      },
    ]);
  });

  it('converts money with the CURRENCY’s own exponent, not a hardcoded 100', () => {
    const [line] = toReceiptLineItemInputs(
      recordFor({ metadata: { Product: 'Bento', Total: 1200, Currency: 'JPY' } }),
    );

    // ¥1,200 is 1200 minor units, not 120000 — and dividing it by 100 later
    // would turn it into ¥12.
    expect(line.totalPriceMinor).toBe(1200);
  });

  it('derives a line total from unit price × quantity when the source states no total', () => {
    const [line] = toReceiptLineItemInputs(
      recordFor({ metadata: { Product: 'Socks', 'Unit Price': 6.5, Quantity: 3, Currency: 'USD' } }),
    );

    expect(line.unitPriceMinor).toBe(650);
    expect(line.totalPriceMinor).toBe(1950);
  });

  it('numbers lines 1-based in the parser’s own order', () => {
    const lines = toReceiptLineItemInputs(
      recordFor({
        classification: 'order',
        metadata: { LineItems: [{ Product: 'A' }, { Product: 'B' }, { Product: 'C' }] },
      }),
    );

    expect(lines.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
    expect(lines.map((l) => l.description)).toEqual(['A', 'B', 'C']);
  });

  it('keeps a stated line number and never lets two lines collide', () => {
    // `(receipt_id, line_number)` is the natural key, and replaceLineItems
    // folds within-batch repeats last-write-wins — so a collision does not
    // fail, it DELETES a line. `[{LineNumber: 2}, {}]` used to yield 2 and 2.
    const lines = toReceiptLineItemInputs(
      recordFor({
        classification: 'order',
        metadata: { LineItems: [{ Product: 'A', LineNumber: 2 }, { Product: 'B' }] },
      }),
    );

    expect(lines.map((l) => l.lineNumber)).toEqual([2, 1]);
    expect(new Set(lines.map((l) => l.lineNumber)).size).toBe(2);
  });

  it('is stable across re-runs of the same export', () => {
    const metadata = { LineItems: [{ Product: 'A' }, { Product: 'B', LineNumber: 7 }, { Product: 'C' }] };
    const first = toReceiptLineItemInputs(recordFor({ classification: 'order', metadata }));
    const second = toReceiptLineItemInputs(recordFor({ classification: 'order', metadata }));

    expect(first.map((l) => l.lineNumber)).toEqual(second.map((l) => l.lineNumber));
  });

  it('judges each line on its OWN fields before the parent’s', () => {
    // A gift card on a grocery run is a real case.
    const lines = toReceiptLineItemInputs(
      recordFor({
        classification: 'order',
        metadata: { LineItems: [{ Product: 'Milk' }, { Product: 'Store Gift Card' }] },
      }),
    );

    expect(lines.map((l) => l.isPhysical)).toEqual([true, false]);
  });

  it('carries a line’s own identifiers as the codes the receipt service resolves on', () => {
    const [line] = toReceiptLineItemInputs(
      recordFor({
        classification: 'order',
        metadata: {
          LineItems: [{ Product: 'Some Book', Identifiers: [{ namespace: 'asin', value: 'B00X4WHP5E' }] }],
        },
      }),
    );

    expect(line.identifierCodes).toEqual({ asin: 'B00X4WHP5E' });
  });

  it('writes no line for a record that names nothing', () => {
    expect(toReceiptLineItemInputs(recordFor({ metadata: {} }))).toEqual([]);
  });
});

describe('receipt lines refuse a negative amount', () => {
  it('writes neither a negative unit price nor a negative line total', () => {
    // Measured before the guard: `unitPriceMinor: -4250, totalPriceMinor:
    // -4250` on a PayPal credit. `ci.receipt_line_items` has no CHECK either.
    const credit = recordFor({
      dataSource: 'paypal',
      metadata: { Product: 'Credit', Total: '-42.50', 'Unit Price': '-42.50', Quantity: 1, Currency: 'USD' },
    });
    const [line] = toReceiptLineItemInputs(credit);

    expect(line.description).toBe('Credit');
    expect(line.unitPriceMinor).toBeUndefined();
    expect(line.totalPriceMinor).toBeUndefined();
  });

  it('refuses a total computed from a negative unit price', () => {
    const credit = recordFor({
      dataSource: 'paypal',
      metadata: { Product: 'Credit', 'Unit Price': '-8.00', Quantity: 2, Currency: 'USD' },
    });

    expect(toReceiptLineItemInputs(credit)[0].totalPriceMinor).toBeUndefined();
  });
});

describe('toReceiptInput', () => {
  const rec = recordFor({
    metadata: {
      Merchant: 'Amazon',
      'Order ID': '114-2233445-6677889',
      Total: '48.62',
      Tax: '3.62',
      Subtotal: '42.50',
      Currency: 'USD',
      LineItems: [{ Product: 'Cast Iron Pan', Total: 42.5 }],
    },
  });

  it('carries the merchant, money and moment', () => {
    const extraction = toReceiptInput(rec, toReceiptLineItemInputs(rec));

    expect(extraction).toMatchObject({
      merchantName: 'Amazon',
      orderNumber: '114-2233445-6677889',
      currency: 'USD',
      totalMinor: 4862,
      taxMinor: 362,
      subtotalMinor: 4250,
      purchasedAt: new Date('2024-03-02T10:00:00Z'),
      sourceType: 'ci-import-tools',
      sourceSystem: 'amazon',
      sourceId: 'hash-1',
    });
  });

  it('prefers a STATED total over the sum of the lines', () => {
    // A stated total includes tax and shipping, which the lines do not, so
    // summing first quietly understates every order.
    expect(toReceiptInput(rec, toReceiptLineItemInputs(rec)).totalMinor).toBe(4862);
  });

  it('falls back to the sum of the lines when the source states no total', () => {
    const noTotal = recordFor({
      classification: 'order',
      metadata: {
        Currency: 'USD',
        LineItems: [
          { Product: 'A', Total: 19.99 },
          { Product: 'B', Total: 42.5 },
        ],
      },
    });

    // 1999 + 4250 in integer minor units — no float noise to round away.
    expect(toReceiptInput(noTotal, toReceiptLineItemInputs(noTotal)).totalMinor).toBe(6249);
  });

  it('never mints a thing a second time from its own lines', () => {
    // The importer OWNS the ci.objects row for a purchase (toThingInput
    // already wrote it). Letting the mint create a unit from the same line is a
    // duplicate possession with no way to tell which is real.
    expect(toReceiptInput(rec, toReceiptLineItemInputs(rec)).skipMint).toBe(true);
  });

  it('declares the claims structured, not OCR', () => {
    // Decides the identity_confidence ReceiptService writes onto every
    // identifier it promotes: a retailer's own order feed is not a crumpled
    // thermal receipt.
    expect(toReceiptInput(rec, toReceiptLineItemInputs(rec)).extractionSource).toBe('structured');
  });

  it('leaves a bare receipt email pending for a better read', () => {
    const email = recordFor({
      dataSource: 'gmail',
      classification: 'receipt',
      metadata: { Merchant: 'Apple', Total: 9.99, Currency: 'USD', Text: 'Your receipt from Apple' },
    });
    const extraction = toReceiptInput(email, toReceiptLineItemInputs(email));

    expect(extraction.extractionState).toBe('pending');
    // The body is the thing a real extraction would re-read, so it rides along.
    expect(extraction.rawText).toBe('Your receipt from Apple');
  });

  it('calls an itemised source extracted', () => {
    expect(toReceiptInput(rec, toReceiptLineItemInputs(rec)).extractionState).toBe('extracted');
  });

  it('refuses a negative total instead of writing a credit as a cost', () => {
    // The TOTAL chain reaches PayPal's SIGNED ledger columns (Amount / Net /
    // Gross) and Amazon's verbatim `Total`. Neither parser clamps, and
    // `ci.receipts.total_minor` has no CHECK, so `-19.99` landed as `-1999` and
    // every spend read summed a refund as a purchase. There is no receipt
    // status column to model a credit with, so the lane refuses it — and says
    // so on the row rather than dropping the number on the floor.
    const refund = recordFor({
      dataSource: 'paypal',
      metadata: { Product: 'Refunded thing', Amount: '-19.99', Currency: 'USD' },
    });
    const extraction = toReceiptInput(refund, toReceiptLineItemInputs(refund));

    expect(extraction.totalMinor).toBeUndefined();
    expect(extraction.metadata?.NegativeTotalRefused).toBe(-19.99);
  });

  it('does not answer a refused total with the sum of its own lines', () => {
    // The line guard empties the negative lines, so a fallback to sumLines
    // would report whatever positive line happened to survive — a credit
    // rebadged as a smaller purchase.
    const mixed = recordFor({
      dataSource: 'paypal',
      metadata: {
        Merchant: 'Shop',
        Amount: '-19.99',
        Currency: 'USD',
        LineItems: [
          { Product: 'Returned pan', Total: -42.5 },
          { Product: 'Restocking fee', Total: 5 },
        ],
      },
    });

    expect(toReceiptInput(mixed, toReceiptLineItemInputs(mixed)).totalMinor).toBeUndefined();
  });

  it('still refuses a negative subtotal or tax', () => {
    const credit = recordFor({
      dataSource: 'paypal',
      metadata: { Merchant: 'Shop', Currency: 'USD', Subtotal: '-10.00', Tax: '-1.00' },
    });
    const extraction = toReceiptInput(credit, toReceiptLineItemInputs(credit));

    expect(extraction.subtotalMinor).toBeUndefined();
    expect(extraction.taxMinor).toBeUndefined();
  });

  it('carries the place the push resolved, and leaves it alone when there is none', () => {
    // `ci.receipts.place_entity_id` is the `place_prior` rung of
    // ObjectResolutionService and the only thing that puts an imported purchase
    // on a map. It was populated by no import path at all.
    expect(
      toReceiptInput(rec, toReceiptLineItemInputs(rec), { placeEntityId: 'entity-place-1' }).placeEntityId,
    ).toBe('entity-place-1');
    expect(toReceiptInput(rec, toReceiptLineItemInputs(rec)).placeEntityId).toBeUndefined();
  });
});

describe('toProductModelInput', () => {
  const book = recordFor({
    dataSource: 'goodreads',
    classification: 'annotation',
    metadata: {
      Title: 'Fahrenheit 451',
      Publisher: 'Simon & Schuster',
      Binding: 'Paperback',
      Identifiers: [{ namespace: 'isbn', value: '9781451673319' }],
    },
  });

  it('keys the catalogue row on the IDENTITY, not on who mentioned it', () => {
    // The same ISBN bought on Amazon, shelved on Goodreads and scanned off a
    // barcode is ONE product. Keying on the record's own sourceId instead mints
    // a catalogue row per source, and first-writer-wins leaves all but the
    // first permanently unreachable by barcode.
    expect(toProductModelInput(book)).toMatchObject({
      title: 'Fahrenheit 451',
      sourceSystem: PRODUCT_MODEL_SOURCE_SYSTEM,
      sourceId: 'isbn:9781451673319',
    });
  });

  it('records which record minted it, since the triple no longer says', () => {
    expect(toProductModelInput(book)?.metadata).toMatchObject({
      mintedFrom: { sourceSystem: 'goodreads', sourceId: 'hash-1' },
    });
  });

  it('carries the product facts a catalogue entry is for', () => {
    expect(toProductModelInput(book)).toMatchObject({
      manufacturer: 'Simon & Schuster',
      spec: { Publisher: 'Simon & Schuster', Binding: 'Paperback' },
    });
  });

  it('refuses a record with no globally-unique identifier', () => {
    expect(
      toProductModelInput(
        recordFor({ metadata: { Product: 'Widget', Identifiers: [{ namespace: 'sku', value: 'WID-1' }] } }),
      ),
    ).toBeNull();
  });

  it('refuses a record that names nothing', () => {
    expect(
      toProductModelInput(
        recordFor({ metadata: { Identifiers: [{ namespace: 'isbn', value: '0306406152' }] } }),
      ),
    ).toBeNull();
  });
});

describe('toObservationInput', () => {
  const purchase = recordFor({
    metadata: {
      Product: 'Some Book',
      Merchant: 'Amazon',
      Identifiers: [{ namespace: 'isbn', value: '9781451673319' }],
    },
  });

  it('records the identified object as seen at the moment it was bought', () => {
    expect(toObservationInput(purchase)).toMatchObject({
      observedAt: new Date('2024-03-02T10:00:00Z'),
      label: 'Some Book',
      labelSource: 'import',
      detector: 'import:receipt',
      sourceId: 'hash-1',
    });
  });

  it('uses a source_kind the column’s CHECK constraint actually allows', () => {
    // Every allowed value describes PIXELS; there is no 'receipt' kind, and
    // adding one is a migration. 'manual' is the closest honest reading and
    // `detector` says what really produced the row.
    expect(toObservationInput(purchase)?.sourceKind).toBe('manual');
  });

  it('refuses an undated record', () => {
    // An observation with no time is not an observation — the fallback date is
    // the moment of import.
    expect(toObservationInput(recordFor({ occurredAt: null, metadata: purchase.metadata }))).toBeNull();
  });

  it('refuses a record that identifies no object', () => {
    expect(toObservationInput(recordFor({ metadata: { Product: 'Cast Iron Pan' } }))).toBeNull();
  });
});
