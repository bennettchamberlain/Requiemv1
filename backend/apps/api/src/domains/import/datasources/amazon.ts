/* Amazon — order history from an Amazon "Your Orders" data export CSV.
   Modern exports ship "Retail.OrderHistory.1.csv" (and "Retail.OrderHistory.*.csv");
   legacy exports used "Order History.csv" / "amazon-order-history.csv". One
   'purchase' item is emitted per row, keyed on the "Order Date" column.

   Digital purchases are further enriched from the files that sit BESIDE the
   order CSVs in a full export (see loadDigitalContext): each line's real
   media mimetype where Amazon states it (Digital.Content.Ownership resource
   types, the Audible marketplace, Appstore entitlements, the music library) —
   with the unclaimed remainder inferred to be video (see digitalMimetype) —
   and a Subscription flag (Digital Orders.csv / the ledger's own Subscription
   Order Type column) that keeps service fees — which are not content at all —
   out of the content table while the per-order commerce.order event still
   marks the purchase. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parseCSV } from './csv';
import type { FileImporter, Recognition, DirEntry } from './registry';
import { registerDataSource } from './registry';
import type { ImportParams, Item } from './timeline';
import { mimeForFile, timeframeContains } from './timeline';

// Filename signature: modern Retail.OrderHistory.* or legacy "Order History".
const FILENAME_RE = /Retail\.OrderHistory|Order.?History/i;

function filenameMatches(name: string): boolean {
  return path.extname(name).toLowerCase() === '.csv' && FILENAME_RE.test(name);
}

// Header sniff: an Amazon order export carries both an order id and product name
// column. Match the modern "Order ID"/"Product Name" pair specifically so we do
// not false-match other importers' CSV fixtures.
function headerMatches(text: string): boolean {
  let header = text;
  if (header.charCodeAt(0) === 0xfeff) {
    header = header.slice(1);
  }

  const nl = header.indexOf('\n');
  if (nl !== -1) {
    header = header.slice(0, nl);
  }

  return /order\s*id/i.test(header) && /product\s*name/i.test(header);
}

/**
 * Read the first column present out of a list of aliases.
 *
 * Amazon renames columns between export vintages, and the rename is silent —
 * the "Your Orders" download calls quantity `Original Quantity` and the amount
 * `Total Amount`, where the "All Data Categories" download calls the same two
 * fields `Quantity` and `Total Owed`. Reading only one spelling does not throw;
 * it yields undefined for every row, which quietly emptied `metadata.Quantity`
 * and disabled the unfulfilled-line guard on the whole export.
 */
function col(row: Record<string, string>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== '') {
      return v;
    }
  }

  return undefined;
}

/*
 * Column dialects. Amazon ships THREE header spellings for the same fields:
 * spaced Title Case ("Order Date" — Retail.OrderHistory, Your Orders), spaced
 * with renames ("Original Quantity"/"Total Amount"), and run-together
 * CamelCase ("OrderDate", "ProductName", "OurPrice" — the Digital-Ordering.1
 * family, e.g. "Digital Items.csv"). Every read goes through these lists so a
 * new vintage is one entry, not a hunt through the file. Order matters: the
 * canonical spaced name first, so files carrying both never regress.
 *
 * CamelCase has no total-paid column at all — `OurPrice` is the pre-tax price
 * (taxes/promos live in the separate "Digital Orders Monetary.csv" ledger,
 * which this importer does not join), so those rows carry a Unit Price but no
 * Total by design.
 *
 * The Audible dialect ("Your Audible Account & Membership/Purchase History.csv")
 * dates on `Order Place Date`, counts on `Units`, and prices on `Net Price` —
 * the cash actually paid, 0.00 when a membership credit covered it, which is
 * the honest price of a credit purchase. Its OTHER price columns are
 * deliberately not read: `Regular Price` is the list price, and
 * `Price Paid Member` is internal bookkeeping (it varies between 0.00 and a
 * member rate across otherwise-identical credit purchases).
 */
const DATE_COLS = ['Order Date', 'OrderDate', 'Order Place Date'];
const ORDER_ID_COLS = ['Order ID', 'OrderId'];
const PRODUCT_COLS = ['Product Name', 'ProductName'];
const QUANTITY_COLS = [
  'Quantity',
  'Original Quantity',
  'OriginalQuantity',
  'Quantity Ordered',
  'QuantityOrdered',
  'Units',
];
const TOTAL_COLS = ['Total Owed', 'Total Amount', 'Total Charged', 'Net Price'];
const UNIT_PRICE_COLS = ['Unit Price', 'OurPrice', 'Net Price'];
const CURRENCY_COLS = ['Currency', 'OurPriceCurrencyCode', 'Base Currency Code', 'BaseCurrencyCode'];

/**
 * Values Amazon puts in the ASIN column that are NOT identifiers. Grocery and
 * Amazon Fresh line items carry the literal sentinel `_ASINLESS_` (every such
 * row in an order shares it), and other vintages leave the column blank or fill
 * it with Amazon's ubiquitous "Not Available" filler. Treating any of these as
 * an id makes distinct products collide.
 */
const ASIN_SENTINELS = new Set(['', '_asinless_', 'not available', 'n/a', 'na']);

/** The ASIN when the column holds a real one, else '' (see ASIN_SENTINELS). */
function realAsin(raw: string): string {
  const trimmed = raw.trim();

  return ASIN_SENTINELS.has(trimmed.toLowerCase()) ? '' : trimmed;
}

/**
 * Identity fallback for a row whose ASIN is a sentinel: a short hash of the
 * product name. Normalised (case-folded, whitespace-collapsed) first, because
 * unlike an ASIN a product name is display text that Amazon re-words between
 * export vintages — folding the cosmetic differences keeps the id stable across
 * as many re-exports as we can manage. Returns '' when there is no name either.
 */
function productIdent(product: string): string {
  const norm = product.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!norm) {
    return '';
  }

  return `p:${crypto.createHash('sha1').update(norm).digest('hex').slice(0, 12)}`;
}

/**
 * Stable per-row identity: `amazon:<order id>:<asin | product-name hash>`.
 *
 * Deliberately carries NO file position. The CSV is sorted newest-order-first,
 * so a row index shifts for the whole history every time a new order is placed
 * — keying on it gave every row a fresh id on each export and re-imported the
 * entire order history as duplicates (the push dedups on this id).
 *
 * Rows that legitimately share the resulting key are the SAME purchase and
 * collapse on the `items` primary key / (data_source, content_hash) index:
 * Amazon emits byte-identical duplicate rows, splits one line item across two
 * shipment rows (different carrier + ship date), and pairs a fulfilled row with
 * a zero-quantity unfulfilled one. Distinct grocery items in one order do NOT
 * collapse — that is what the product-name fallback is for.
 */
function rowIdentity(row: Record<string, string>, orderId: string, base: string): string {
  const asin = realAsin(row['ASIN'] || row['ASIN/ISBN'] || row['ISBN'] || '');
  let ident = asin || productIdent(col(row, ...PRODUCT_COLS) || '');
  if (!ident) {
    // No identifier and no name. Nothing describes this row but its own
    // contents, so hash those — still position-free, unlike a row index.
    const shape = Object.keys(row)
      .sort()
      .map((k) => `${k}=${row[k] ?? ''}`)
      .join('\0');
    ident = `r:${crypto.createHash('sha1').update(shape).digest('hex').slice(0, 12)}`;
  }

  return `amazon:${orderId || base}:${ident}`;
}

/**
 * Why this row is not a purchase, or null when it is one.
 *
 * Importing a non-purchase is actively wrong rather than merely noisy:
 * `Unit Price` survives on these rows and is what the inventory mapping reads
 * for `purchasePrice`, so each one lands in stock at full price having never
 * been bought.
 *
 * Two independent signals, because neither covers the other:
 *
 * - `Order Status` is Amazon's own verdict and is authoritative. A cancelled
 *   order can still carry a non-zero `Total Owed` (the amount that WOULD have
 *   been charged), so an amount-based test alone lets it through.
 * - A zero quantity AND a zero amount owed catches the unfulfilled line inside
 *   an order whose status is `Closed` — Amazon pairs the fulfilled row with a
 *   zeroed one, or leaves a lone never-shipped line behind. Both fields must
 *   parse as a real 0: a blank or "Not Available" cell is not a zero, and a
 *   zero-quantity row that still owes money under a non-cancelled status is
 *   left alone for a human to interpret.
 */
function dropReason(row: Record<string, string>): string | null {
  if (/cancel/i.test(row['Order Status'] ?? '')) {
    return 'cancelled_order';
  }

  const num = (raw: string | undefined): number => {
    if (raw === undefined) {
      return NaN;
    }

    const trimmed = raw.trim();

    return trimmed === '' ? NaN : Number(trimmed);
  };

  if (num(col(row, ...QUANTITY_COLS)) === 0 && num(col(row, ...TOTAL_COLS)) === 0) {
    return 'unfulfilled_line';
  }

  return null;
}

/** The row's Order Date as a Date, or undefined when absent/unparseable. */
function rowTimestamp(row: Record<string, string>): Date | undefined {
  const raw = col(row, ...DATE_COLS);
  if (!raw) {
    return undefined;
  }

  const d = new Date(raw);

  return isNaN(d.getTime()) ? undefined : d;
}

/** Discard rows that are byte-for-byte repeats of one already seen. */
function dedupeIdenticalRows(rows: Record<string, string>[]): Record<string, string>[] {
  const seen = new Set<string>();
  const out: Record<string, string>[] = [];
  for (const row of rows) {
    const shape = JSON.stringify(
      Object.keys(row)
        .sort()
        .map((k) => [k, row[k] ?? '']),
    );
    if (seen.has(shape)) {
      continue;
    }

    seen.add(shape);
    out.push(row);
  }

  return out;
}

/** Sum the parseable values, ignoring "Not Available"/blank cells. */
function sumOf(values: (string | undefined)[]): number | undefined {
  const nums = values
    .map((v) => (v === undefined || v.trim() === '' ? NaN : Number(v)))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) {
    return undefined;
  }

  return nums.reduce((a, b) => a + b, 0);
}

/** Money as a metadata string: 2dp for fractional amounts, bare for whole ones. */
function money(n: number | undefined): string | undefined {
  if (n === undefined) {
    return undefined;
  }

  const rounded = Math.round(n * 100) / 100;

  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Merge the rows of ONE order line from an order-history CSV.
 *
 * Amazon splits a multi-unit line across one row per SHIPMENT — the same order
 * id and ASIN, each row carrying that shipment's own quantity and amount (its
 * `Shipment Item Subtotal` is that row's unit price × that row's quantity, so
 * the parts are genuinely disjoint). Keeping only one row understated the
 * holding: a line of 5 units shipped 2-then-3 was recorded as 2.
 *
 * A single-row line keeps its raw strings untouched; only a real merge
 * recomputes, and it records `Shipments` so the merge is visible rather than
 * silent.
 */
function mergeLine(rows: Record<string, string>[]): Record<string, string | number | undefined> {
  const primary = rows[0];
  const currency = col(primary, ...CURRENCY_COLS);
  const unitPrice = col(primary, ...UNIT_PRICE_COLS);
  if (rows.length === 1) {
    const qtyRaw = col(primary, ...QUANTITY_COLS);
    const qty = qtyRaw !== undefined ? Number(qtyRaw) : undefined;

    return {
      Quantity: qty !== undefined && !isNaN(qty) ? qty : undefined,
      Total: col(primary, ...TOTAL_COLS),
      Currency: currency,
      'Unit Price': unitPrice,
    };
  }

  return {
    Quantity: sumOf(rows.map((r) => col(r, ...QUANTITY_COLS))),
    Total: money(sumOf(rows.map((r) => col(r, ...TOTAL_COLS)))),
    Currency: currency,
    'Unit Price': unitPrice,
    Shipments: rows.length,
  };
}

/**
 * Is everything in this file digital by definition?
 *
 * Amazon files its digital purchases into their own files and says so in the
 * name — "Digital Content Orders.csv", "Digital Items.csv",
 * "Retail.DigitalSoftwareAndVideogames.Entitlements.1.csv". Nothing in those
 * rows is a physical object, so they belong in CI-Server's `content` table,
 * not `inventory`. The mapping otherwise guesses from the product name
 * (mapping.ts `isDigitalGood`), which cannot know that "Prime Membership Fee"
 * is not a thing on a shelf — 143 of these landed in physical inventory. The
 * filename is the reliable signal, so items from such a file carry an explicit
 * `metadata.Digital` that overrides the guess.
 *
 * Matched as a bare substring rather than a whole word on purpose: Amazon runs
 * the words together ("DigitalSoftwareAndVideogames"), which a `\b`-anchored
 * pattern would miss.
 */
function isDigitalContentFile(base: string): boolean {
  return /digital/i.test(base);
}

/**
 * Is this the Audible purchase-history dialect?
 *
 * Audible's file is just "Purchase History.csv" — the name says nothing — but
 * its columns are unmistakable: no other Amazon order export carries
 * `Consumed Credit` alongside `Net Price`. An audiobook is digital content by
 * definition, so rows from this file take the same `metadata.Digital` routing
 * as the Digital-named files.
 */
function isAudiblePurchaseFile(rows: Record<string, string>[]): boolean {
  const first = rows[0];

  return !!first && 'Consumed Credit' in first && 'Net Price' in first;
}

/**
 * CREDIT or CASH for an Audible purchase — the context a 0.00 Net Price needs
 * (a credit-covered audiobook is not a free one). `Type` states it outright;
 * a vintage without `Type` still carries `Consumed Credit`, and a consumed
 * credit is the same fact.
 */
function audiblePayment(row: Record<string, string>): string | undefined {
  const t = (row['Type'] || '').trim().toUpperCase();
  if (t === 'CREDIT' || t === 'CASH') {
    return t;
  }

  const credit = Number(row['Consumed Credit']);
  if (Number.isFinite(credit)) {
    return credit > 0 ? 'CREDIT' : 'CASH';
  }

  return undefined;
}

/**
 * Does this CSV hold MONETARY COMPONENTS rather than order lines?
 *
 * "Digital Content Orders.csv" is a ledger: each row is one component of a
 * digital purchase — the price, its tax, a promotion, a coupon — carrying a
 * signed `Transaction Amount`, so one purchase spans several rows. It sniffs
 * as order history (it has an Order ID and a Product Name), and treating its
 * rows as line items produced one priceless item per component.
 */
function isComponentLedger(rows: Record<string, string>[]): boolean {
  const first = rows[0];

  return !!first && 'Component Type' in first && 'Transaction Amount' in first;
}

/**
 * Collapse a component ledger's rows into the one purchase they describe.
 *
 * `Transaction Amount` is signed and the components are disjoint, so their sum
 * is what was actually paid including tax and net of any promotion or coupon
 * (Prime: 139.00 price + 10.77 tax = 149.77). `Price` and `List Price Amount`
 * are line-level and repeat on every row, so they are read once — keeping both
 * is what records that a $1.99 game was taken for $0.00 on a promotion.
 */
function ledgerFields(rows: Record<string, string>[]): Record<string, string | number | undefined> {
  const primary = rows[0];
  const paid = sumOf(rows.map((r) => r['Transaction Amount']));
  const price = sumOf([primary['Price']]);
  const list = sumOf([primary['List Price Amount']]);
  const qty = sumOf([col(primary, ...QUANTITY_COLS)]);

  return {
    Quantity: qty,
    Total: money(paid),
    Currency:
      primary['Base Currency Code'] || primary['Price Currency Code'] || primary['Currency'] || undefined,
    'Unit Price': money(price),
    // Only interesting when it differs from what was charged.
    'List Price': list !== undefined && price !== undefined && list !== price ? money(list) : undefined,
    Components: rows.length,
  };
}

function sniffHeader(fpath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(fpath, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);

    return headerMatches(buf.toString('utf8', 0, n));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Digital.Content.Ownership resourceType → the item's media mimetype. The
 * ownership records are Amazon's own per-ASIN taxonomy of what a digital
 * thing IS, so these are stated facts, not guesses. Anything bought from
 * Amazon in these classes is definitionally in Amazon's format: Kindle books
 * (incl. samples and sideloaded personal docs) are Kindle-format ebooks,
 * music is mp3, Appstore apps are Android packages.
 */
const RESOURCE_TYPE_MIME: Record<string, string> = {
  KindleEBook: 'application/vnd.amazon.ebook',
  KindleEBookSample: 'application/vnd.amazon.ebook',
  KindlePDoc: 'application/vnd.amazon.ebook',
  DigitalMusicTrack: 'audio/mpeg',
  DigitalMusic: 'audio/mpeg',
  MobileApp: 'application/vnd.android.package-archive',
};

/** Title normalization for the Prime Video match: quotes/case/space-insensitive. */
function normTitle(raw: string): string {
  return raw
    .replace(/^"+|"+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The row's product name, with Amazon's redaction fillers read as no name. */
function realProductName(row: Record<string, string>): string {
  const raw = (col(row, ...PRODUCT_COLS) ?? '').trim();

  return /^not (applicable|available)$/i.test(raw) ? '' : raw;
}

/**
 * A digital line whose name says it is NOT a video: boxed-software downloads
 * ("TurboTax … Tax Software"), console/game codes ("… - PS4 [Digital Code]",
 * "[Online Game Code]"), gift cards, and service fees ("Prime Membership
 * Fee", "Kindle Unlimited" — the belt-and-braces backstop for when the
 * subscription join has no Digital Orders.csv in reach). These are the known
 * exceptions to the video-by-elimination fallback below — they resolve
 * through none of the sidecar signals but are certainly not videos.
 */
const NON_VIDEO_NAME_RE =
  /software|game code|digital code|gift card|membership|subscription|kindle unlimited/i;

/**
 * What the rest of the archive knows about digital purchases. Loaded once per
 * import from the files beside the order CSVs (same sibling-walk pattern
 * kindle_reading uses for titles); every map is best-effort — a bare-file
 * drop or an orders-only export just yields empty maps and the purchase
 * imports exactly as before.
 */
interface DigitalContext {
  /** ASIN → resourceType from the Digital.Content.Ownership JSON records. */
  ownership: Map<string, string>;
  /** ASINs of Appstore app entitlements (Appstore.Entitlements PDI.csv). */
  appAsins: Set<string>;
  /** Track/album ASIN → audio mimetype from the Your Music Library CSVs. */
  musicAsins: Map<string, string>;
  /** Order ids Digital Orders.csv marks Subscription_Signup/_Renewal. */
  subscriptionOrders: Set<string>;
}

const EMPTY_DIGITAL_CONTEXT: DigitalContext = {
  ownership: new Map(),
  appAsins: new Set(),
  musicAsins: new Map(),
  subscriptionOrders: new Set(),
};

export class AmazonFileImporter implements FileImporter {
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

      // Filename alone used to be enough for the top confidence tier — but
      // "Order History.csv" is boilerplate phrasing several other retailers'
      // own "download your data" exports use verbatim (eBay, Target,
      // Walmart-style tools), with completely different columns. Require the
      // same header verification the unnamed fallback below already does, so
      // a same-named CSV from elsewhere is never claimed on filename alone.
      if (filenameMatches(base)) {
        return sniffHeader(root) ? { confidence: 0.95 } : { confidence: 0 };
      }

      if (path.extname(base).toLowerCase() === '.csv' && sniffHeader(root)) {
        return { confidence: 0.85 };
      }

      return { confidence: 0 };
    }

    if (stat.isDirectory()) {
      const found = this.findFiles(root);
      if (found.length) {
        return { confidence: 0.95 };
      }

      return { confidence: 0, dir_threshold: 0.7 };
    }

    return { confidence: 0 };
  }

  // Locate Amazon order CSVs in a directory, recursing through the nested
  // folders Amazon's archives use — "Your Orders" keeps CSVs one level down,
  // but a full "All Data Categories" export (plus a drag-and-drop staging
  // wrapper) buries Digital-Ordering.1 three or four levels deep.
  private findFiles(dir: string, depth = 0): string[] {
    const out: string[] = [];
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }

    for (const dirent of names) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (depth < 4) {
          out.push(...this.findFiles(full, depth + 1));
        }
      } else if (dirent.isFile()) {
        if (filenameMatches(dirent.name)) {
          out.push(full);
        } else if (path.extname(dirent.name).toLowerCase() === '.csv' && sniffHeader(full)) {
          out.push(full);
        }
      }
    }

    return out;
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

    let files: string[] = [];
    if (stat.isFile()) {
      files = [root];
    } else if (stat.isDirectory()) {
      files = this.findFiles(root);
    }

    // The digital sidecars (ownership records, entitlements, viewing history)
    // are only worth walking for when a digital file actually imports, so the
    // load is lazy and memoized. A bare-file drop still reads its siblings.
    let digitalCtx: DigitalContext | undefined;
    const searchRoot = stat.isDirectory() ? root : path.dirname(root);
    const getDigitalCtx = () => (digitalCtx ??= this.loadDigitalContext(searchRoot, params));

    for (const fpath of files) {
      await this.processFile(fpath, getDigitalCtx, params);
    }
  }

  /**
   * Walk the export around the order CSVs for the digital sidecar files. The
   * ownership records nest as Additional Data/Digital.Content.Ownership/*.json
   * (one JSON object per owned item), the Appstore entitlements as
   * Appstore.Entitlements/datasets/PDI/PDI.csv — identified by header, since
   * "PDI.csv" alone names nothing — the music library as "Your Music
   * Library"/Saved Music.csv, and Digital Orders.csv sits beside
   * Digital Items.csv itself. Depth mirrors kindle_reading's title walk: the
   * deepest target is four levels down, five under a staged drop's wrapper.
   */
  private loadDigitalContext(searchRoot: string, params: ImportParams): DigitalContext {
    const ctx: DigitalContext = {
      ownership: new Map(),
      appAsins: new Set(),
      musicAsins: new Map(),
      subscriptionOrders: new Set(),
    };
    // One ownership record: { resource: { resourceType, ASIN, parent? } }.
    // The parent is the containing thing (a track's album) — as good a type
    // statement as the resource itself, so both land in the map.
    const takeResource = (r: unknown) => {
      if (!r || typeof r !== 'object') {
        return;
      }

      const res = r as { resourceType?: string; ASIN?: string; parent?: unknown };
      const asin = (res.ASIN ?? '').trim();
      if (asin && !/^not available$/i.test(asin) && res.resourceType && !ctx.ownership.has(asin)) {
        ctx.ownership.set(asin, res.resourceType);
      }

      if (res.parent) {
        takeResource(res.parent);
      }
    };

    const walk = (dir: string, depth: number) => {
      let names: fs.Dirent[];
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const dirent of names) {
        const full = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          if (depth < 6) {
            walk(full, depth + 1);
          }

          continue;
        }

        if (!dirent.isFile()) {
          continue;
        }

        try {
          if (/^Digital\.Content\.Ownership.*\.json$/i.test(dirent.name)) {
            const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
            for (const rec of Array.isArray(parsed) ? parsed : [parsed]) {
              takeResource((rec as { resource?: unknown })?.resource);
            }
          } else if (/^PDI\.csv$/i.test(dirent.name)) {
            for (const row of parseCSV(fs.readFileSync(full, 'utf8'))) {
              if (!('Entitlement Date' in row)) {
                break;
              } // some other PDI.csv

              const asin = (row['ASIN'] ?? '').trim();
              if (asin) {
                ctx.appAsins.add(asin);
              }
            }
          } else if (/^Saved Music\.csv$/i.test(dirent.name)) {
            // The music library names its tracks' and albums' ASINs and file
            // extension — a purchased single that never resolves through the
            // ownership records is still typed by its library row.
            for (const row of parseCSV(fs.readFileSync(full, 'utf8'))) {
              const ext = (row['File Extension'] ?? '').trim().replace(/^\./, '').toLowerCase();
              const mime =
                (ext && !/^not available$/i.test(ext) ? mimeForFile(`track.${ext}`) : undefined) ??
                'audio/mpeg';
              for (const key of ['ASIN', 'Album ASIN']) {
                const asin = (row[key] ?? '').trim();
                if (asin && !/^not available$/i.test(asin) && !ctx.musicAsins.has(asin)) {
                  ctx.musicAsins.set(asin, mime);
                }
              }
            }
          } else if (/^Digital Orders\.csv$/i.test(dirent.name)) {
            for (const row of parseCSV(fs.readFileSync(full, 'utf8'))) {
              const sub = (row['SubscriptionOrderType'] ?? row['Subscription Order Type'] ?? '').trim();
              const oid = (row['OrderId'] ?? row['Order ID'] ?? '').trim();
              if (oid && /^Subscription/i.test(sub)) {
                ctx.subscriptionOrders.add(oid);
              }
            }
          }
        } catch (e) {
          params.log?.('warn', `Failed to read digital sidecar ${dirent.name}`, {
            error: (e as Error).message,
          });
        }
      }
    };

    walk(searchRoot, 0);

    return ctx;
  }

  private async processFile(
    fpath: string,
    getDigitalCtx: () => DigitalContext,
    params: ImportParams,
  ): Promise<void> {
    const base = path.basename(fpath);
    let raw: string;
    try {
      raw = await fs.promises.readFile(fpath, 'utf8');
    } catch (e) {
      params.log?.('error', `Failed to read ${base}`, { error: (e as Error).message });

      return;
    }

    // Strip UTF-8 BOM before parsing.
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }

    let rows: Record<string, string>[];
    try {
      rows = parseCSV(raw);
    } catch (e) {
      params.log?.('error', `Failed to parse ${base}`, { error: (e as Error).message });

      return;
    }

    // One ORDER LINE — not one CSV row — becomes one item. Amazon splits a
    // single line across rows in two different ways (see mergeLine and
    // ledgerFields), so rows are grouped on the identity first and merged after.
    const ledger = isComponentLedger(rows);
    const audible = isAudiblePurchaseFile(rows);
    const digital = isDigitalContentFile(base) || audible;
    const gamesFile = /DigitalSoftwareAndVideogames/i.test(base);
    const digitalCtx = digital ? getDigitalCtx() : EMPTY_DIGITAL_CONTEXT;
    const groups = new Map<string, Record<string, string>[]>();
    for (const row of rows) {
      try {
        const id = this.admit(row, base, params);
        if (!id) {
          continue;
        }

        const seen = groups.get(id);
        if (seen) {
          seen.push(row);
        } else {
          groups.set(id, [row]);
        }
      } catch (e) {
        params.log?.('error', `Failed to read row in ${base}`, { error: (e as Error).message });
      }
    }

    const lines: Item[] = [];
    for (const [id, lineRows] of groups) {
      try {
        const item = this.pushLine(id, lineRows, ledger, digital, gamesFile, digitalCtx, params);
        if (item) {
          lines.push(item);
        }
      } catch (e) {
        params.log?.('error', `Failed to import line in ${base}`, { error: (e as Error).message });
      }
    }

    this.pushOrders(lines, params);
  }

  /**
   * One 'order' item per order id — the ACT of purchasing, which becomes the
   * order's single timeline EVENT in CI-Server (kind commerce.order → events).
   * The per-line items above are the THINGS and keep their inventory/content
   * homes; without this, a five-item order was either five timeline events or
   * none. Aggregated from the emitted lines, so dropped rows (cancelled,
   * unfulfilled) and out-of-timeframe lines never contribute.
   */
  private pushOrders(lines: Item[], params: ImportParams): void {
    interface OrderAgg {
      ts?: Date;
      total?: number;
      currency?: string;
      products: string[];
    }
    const orders = new Map<string, OrderAgg>();
    for (const line of lines) {
      const m = line.metadata ?? {};
      const oid = typeof m['Order ID'] === 'string' ? m['Order ID'] : '';
      if (!oid) {
        continue;
      } // no real order id — nothing to aggregate under

      let agg = orders.get(oid);
      if (!agg) {
        agg = { products: [] };
        orders.set(oid, agg);
      }

      if (line.timestamp && (!agg.ts || line.timestamp < agg.ts)) {
        agg.ts = line.timestamp;
      }

      const total = Number(m.Total);
      if (Number.isFinite(total)) {
        agg.total = (agg.total ?? 0) + total;
      }

      if (!agg.currency && typeof m.Currency === 'string') {
        agg.currency = m.Currency;
      }

      if (typeof m.Product === 'string' && m.Product) {
        agg.products.push(m.Product);
      }
    }

    for (const [oid, agg] of orders) {
      const count = agg.products.length || 1;
      const summary = agg.products.join('\n');
      params.pipeline.push({
        item: {
          // Distinct namespace from the line ids (`amazon:<oid>:<ident>`), and
          // just as position-free: a re-export maps onto the same event.
          id: `amazon:order:${oid}`,
          classification: 'order',
          timestamp: agg.ts,
          content: { filename: 'order.txt', mediaType: 'text/plain', data: async () => Buffer.from(summary) },
          metadata: {
            Title: `Amazon order — ${count} item${count === 1 ? '' : 's'}`,
            // The product list rides in Description so the event embeds and
            // searches on what was bought, not just the constant title.
            Description: summary || undefined,
            'Order ID': oid,
            'Item Count': count,
            Total: money(agg.total),
            // Also under `Amount` — the key LifeStatsService's spend chart
            // reads (`amountToMinorSql` is `metadata->>'Amount'`, the
            // convention coinbase.ts and venmo.ts already follow). `Total` was
            // the only key written here, so a real import with $45.8k across
            // 619 orders showed a Spending panel that said to go import
            // purchase history — which was already sitting there, unread.
            Amount: money(agg.total),
            Currency: agg.currency,
            Source: 'Amazon',
          },
        },
      });
    }
  }

  /** The identity a row belongs under, or null when it is not an importable purchase. */
  private admit(row: Record<string, string>, base: string, params: ImportParams): string | null {
    if (!col(row, ...DATE_COLS)) {
      return null;
    } // skip rows with no Order Date

    const ts = rowTimestamp(row);
    if (!timeframeContains(params.timeframe, ts)) {
      return null;
    }

    const reason = dropReason(row);
    if (reason) {
      params.pipeline.drop?.(reason, col(row, ...PRODUCT_COLS));

      return null;
    }

    // A digital line whose product name Amazon redacted to "Not Applicable"
    // (a handful of small rentals in a real export) describes nothing — the
    // row has an ASIN and a price but no product, so a content row built from
    // it is an unlabeled mystery. Dropped, and counted in the ledger.
    if (isDigitalContentFile(base) && !realProductName(row)) {
      params.pipeline.drop?.('unnamed_product', realAsin(row['ASIN'] ?? '') || undefined);

      return null;
    }

    return rowIdentity(row, col(row, ...ORDER_ID_COLS) || '', base);
  }

  /**
   * A subscription line — a service fee (Prime, Kindle Unlimited, an Audible
   * plan), not a thing. Two sources of the same fact, per dialect: the ledger
   * carries its own `Subscription Order Type` column on every row, where
   * Digital Items.csv states it only order-level in the sibling
   * Digital Orders.csv (joined by order id in loadDigitalContext).
   */
  private isSubscriptionLine(
    primary: Record<string, string>,
    orderId: string | undefined,
    ctx: DigitalContext,
  ): boolean {
    const own = (col(primary, 'Subscription Order Type', 'SubscriptionOrderType') ?? '').trim();
    if (/^Subscription/i.test(own)) {
      return true;
    }

    return !!orderId && ctx.subscriptionOrders.has(orderId);
  }

  /**
   * The digital good's media mimetype, where Amazon states or implies it —
   * undefined when nothing does (the line keeps its text/plain stub rather
   * than a guessed type). Precedence runs strongest-signal-first: the Audible
   * marketplace, the ownership records, the Appstore entitlements, and the
   * music library are per-item statements. What none of them claims falls to
   * INFERENCE: everything else Amazon sells digitally on the retail
   * marketplace is, overwhelmingly, video — the ownership records name every
   * ebook, song, and app, so the residue is video purchases whether or not
   * they were ever streamed. Assumed mp4. The known non-video residue is
   * excluded by name (software/game codes/services — NON_VIDEO_NAME_RE), by
   * file (`gamesFile`: the DigitalSoftwareAndVideogames entitlements are
   * games by definition), and by having no real product name at all.
   */
  private digitalMimetype(
    primary: Record<string, string>,
    asin: string,
    product: string,
    audibleFile: boolean,
    gamesFile: boolean,
    ctx: DigitalContext,
  ): string | undefined {
    if (audibleFile || (primary['Marketplace'] ?? '').trim().toLowerCase() === 'www.audible.com') {
      return 'audio/vnd.audible.aax';
    }

    const owned = asin ? ctx.ownership.get(asin) : undefined;
    if (owned && RESOURCE_TYPE_MIME[owned]) {
      return RESOURCE_TYPE_MIME[owned];
    }

    if (asin && ctx.appAsins.has(asin)) {
      return 'application/vnd.android.package-archive';
    }

    if (asin && ctx.musicAsins.has(asin)) {
      return ctx.musicAsins.get(asin);
    }

    const name = normTitle(product);
    if (!name || name === 'not applicable' || name === 'not available') {
      return undefined;
    }

    if (gamesFile || NON_VIDEO_NAME_RE.test(name)) {
      return undefined;
    }

    return 'video/mp4';
  }

  private pushLine(
    id: string,
    lineRows: Record<string, string>[],
    ledger: boolean,
    digital: boolean,
    gamesFile: boolean,
    digitalCtx: DigitalContext,
    params: ImportParams,
  ): Item {
    // Amazon repeats a row verbatim in some exports. An exact duplicate is not
    // a second shipment or a second component, so it must be discarded BEFORE
    // any summing — otherwise it doubles the quantity it duplicates.
    const rows = dedupeIdenticalRows(lineRows);
    const primary = rows[0];
    const product = col(primary, ...PRODUCT_COLS) || '';
    // Earliest of the line's rows: a split shipment carries one Order Date, but
    // taking the minimum is right regardless and never depends on row order.
    const ts = rows
      .map(rowTimestamp)
      .filter((d): d is Date => d !== undefined)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    // Modern "Retail.OrderHistory.*.csv" carries the product taxonomy in a
    // `Category` column (Amazon's internal product type, e.g. ELECTRONIC_CABLE,
    // ABIS_BOOK, ABIS_KITCHEN) plus an ASIN/ISBN identifier. Surface both so the
    // CI-Server inventory mapping can record a real category instead of the
    // single generic "commerce" bucket. Header names vary slightly across export
    // vintages, so accept the common aliases.
    const category = primary['Category'] || primary['Product Category'] || '';
    // Only a REAL asin reaches metadata — `_ASINLESS_` was being forwarded to
    // CI-Server as identifierCodes.asin, as though it identified a product.
    const asin = realAsin(primary['ASIN'] || primary['ASIN/ISBN'] || primary['ISBN'] || '');
    const condition = primary['Product Condition'] || primary['Condition'] || '';
    // Audible only (the dialect is row-shaped, so the primary row carries it):
    // was this bought with cash or a membership credit? Named `Payment`, not the
    // column's own `Type` — mapping.ts reads metadata.Type as a category
    // taxonomy, which CREDIT/CASH is not.
    const audibleFile = isAudiblePurchaseFile(rows);
    const payment = audibleFile ? audiblePayment(primary) : undefined;

    const orderId = col(primary, ...ORDER_ID_COLS);
    // A subscription fee is a service, not content: it gets no mimetype, and
    // metadata.Subscription routes it out of the content table entirely
    // (mapping.destinationsFor) — the per-order commerce.order event still
    // marks the purchase. The mimetype below is the bought THING's type, not
    // the text stub's; these items carry no file path, so nothing tries to
    // upload the stub as media bytes.
    const subscription = digital && this.isSubscriptionLine(primary, orderId, digitalCtx);
    const mediaType =
      digital && !subscription
        ? this.digitalMimetype(primary, asin, product, audibleFile, gamesFile, digitalCtx)
        : undefined;

    const item: Item = {
      id,
      classification: 'purchase',
      timestamp: ts,
      // A digital line no signal could type carries NO mimetype — better no
      // claim than a wrong one (text/plain described the stub, not the good).
      // Physical lines keep the stub's honest text/plain; nothing reads it.
      content: {
        filename: 'purchase.txt',
        mediaType: digital ? mediaType : 'text/plain',
        data: async () => Buffer.from(product),
      },
      metadata: {
        Product: product || undefined,
        ...(ledger ? ledgerFields(rows) : mergeLine(rows)),
        // The purchase date, restated in metadata: content rows have no time
        // column in CI-Server (CreateContentInput carries none), so without
        // this a digital purchase arrived with no date anywhere — not even in
        // source_data.
        'Order Date': ts?.toISOString(),
        'Order ID': orderId,
        Category: category || undefined,
        ASIN: asin || undefined,
        Condition: condition || undefined,
        Payment: payment,
        // Routes the record to `content` instead of `inventory` — see
        // isDigitalContentFile. Only ever set true; left off otherwise so the
        // mapping's product-name heuristic still decides for other files.
        Digital: digital || undefined,
        Subscription: subscription || undefined,
        Source: 'Amazon',
      },
    };
    params.pipeline.push({ item });

    return item;
  }
}

registerDataSource({
  name: 'amazon',
  title: 'Amazon',
  icon: '',
  description: 'Order history from an Amazon "Your Orders" data export CSV.',
  newFileImporter: () => new AmazonFileImporter(),
});
