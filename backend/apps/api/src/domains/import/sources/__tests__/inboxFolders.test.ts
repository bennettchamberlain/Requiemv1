import { WIZARD_SOURCES } from '../guides';
import { declaredSourcesForInboxUnit, serviceInboxFolders } from '../inboxFolders';

/**
 * The service-folder derivation and the unit → declared-sources mapping.
 *
 * Real guide data, deliberately: the folders ARE the guides' `inboxPath`
 * values, and a test on synthetic paths would keep passing while the mapping
 * drifted away from what the scan actually creates.
 */

describe('serviceInboxFolders', () => {
  it('offers only top-level folders, never per-product subpaths', () => {
    const folders = serviceInboxFolders();

    expect(folders).toContain('amazon');
    expect(folders).toContain('reddit');
    // Nested guide paths collapse to their ecosystem folder: nobody should
    // have to know which products their archive contains to file it.
    expect(folders).toContain('google-takeout');
    expect(folders.some((folder) => folder.includes('/'))).toBe(false);

    // Distinct: five Amazon sources share 'amazon', which appears once.
    expect(new Set(folders).size).toBe(folders.length);
  });

  it('creates no folder for a source whose importer is not ready', () => {
    const topSegment = (inboxPath: string) => inboxPath.split('/')[0];
    const readyTops = new Set(
      WIZARD_SOURCES.filter((source) => source.importerReady && source.inboxPath != null).map(
        (source) => topSegment(source.inboxPath as string),
      ),
    );
    const offered = new Set(serviceInboxFolders());

    // Only folders no ready source shares — 'browser' style sharing means a
    // stub sibling cannot suppress a ready importer's folder.
    const stubOnly = WIZARD_SOURCES.filter(
      (source) => source.inboxPath != null && !source.importerReady,
    )
      .map((source) => topSegment(source.inboxPath as string))
      .filter((top) => !readyTops.has(top));

    for (const folder of stubOnly) {
      expect(offered.has(folder)).toBe(false);
    }
  });
});

describe('declaredSourcesForInboxUnit', () => {
  it('declares nothing for a unit at the inbox root', () => {
    expect(declaredSourcesForInboxUnit('Takeout.zip')).toBeNull();
  });

  it('declares every importer sharing the folder for a unit inside it', () => {
    const declared = declaredSourcesForInboxUnit('amazon/orders.zip');

    expect(declared).toEqual(
      expect.arrayContaining(['amazon', 'prime_video', 'audible', 'kindle_reading', 'amazon_music']),
    );
  });

  it('declares the folder when the folder ITSELF is the unit', () => {
    // Recognition can make the whole service folder one directory unit.
    expect(declaredSourcesForInboxUnit('amazon')).toContain('amazon');
  });

  it('declares a nested folder for a unit under it', () => {
    expect(declaredSourcesForInboxUnit('google-takeout/Mail/All mail.mbox')).toContain('gmail');
  });

  it('declares the whole bundle for the ancestor folder ITSELF as the unit', () => {
    // Google, Microsoft and Apple have only NESTED inboxPaths, so the
    // top-level folder unit must match by being their ancestor — without
    // this, `google-takeout/` as a unit declared nothing (and imported
    // undeclared).
    expect(declaredSourcesForInboxUnit('google-takeout')).toEqual(
      expect.arrayContaining(['gmail', 'google_photos', 'google_chrome']),
    );
    expect(declaredSourcesForInboxUnit('microsoft')).toEqual(
      expect.arrayContaining(['microsoft_account']),
    );
    expect(declaredSourcesForInboxUnit('apple')).not.toBeNull();
  });

  it('declares the whole bundle for a unit in an ancestor of nested folders', () => {
    const declared = declaredSourcesForInboxUnit('google-takeout/takeout-20260818.zip') ?? [];

    // A Takeout dropped one level up declares every Takeout product folder.
    expect(declared).toEqual(expect.arrayContaining(['gmail', 'google_photos', 'google_chrome']));
    // But not services from unrelated folders.
    expect(declared).not.toContain('reddit');
  });

  it('matches folder names case-insensitively', () => {
    expect(declaredSourcesForInboxUnit('Amazon/orders.zip')).toContain('amazon');
  });

  it('does not treat a sibling folder with a shared prefix as the folder', () => {
    // 'amazon-old' must not match 'amazon': segments, not string prefixes.
    expect(declaredSourcesForInboxUnit('amazon-old/orders.zip')).toBeNull();
  });
});
