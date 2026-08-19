import { WIZARD_SOURCES } from './guides';

/**
 * The inbox's service folders: CI-Import-Tools' `data/inbox/<folder>/` layout,
 * rebuilt from the `inboxPath` each guide already carries.
 *
 * The folders exist to capture INTENT. An inbox run has no wizard card behind
 * it, so the usage roll-up can credit only its dominant detected source — a
 * multi-service archive (a full Takeout, an Amazon all-data export) marks one
 * tile and silently drops the rest. A unit dropped inside `amazon/` says what
 * the wizard card would have said: this is my Amazon export. That statement
 * becomes the run's `declared_sources`, and the roll-up credits
 * declared ∩ detected exactly as it does for wizard runs.
 *
 * Only sources whose importer actually exists get a folder and a declaration:
 * a folder for a stub importer is a drop target that consumes bytes nothing
 * can parse, and `declared_sources` is kept strictly to registered importer
 * names (see the controller's parseDeclaredSources for why).
 */

interface ServiceFolder {
  /** POSIX path relative to the inbox root, straight from the guide. */
  path: string;
  segments: readonly string[];
  importers: ReadonlySet<string>;
}

/**
 * One entry per distinct `inboxPath`, importers unioned across the sources
 * that share it — `browser/` is both Chromium and Firefox, `amazon/` is all
 * five Amazon-ecosystem sources. `alsoImporters` is included because a folder
 * declares an EXPORT, and everything that export feeds is declared intent
 * (an Apple Contacts drop is honestly both `apple_contacts` and `vcard`).
 *
 * Built once at module load: the guides are static data.
 */
const SERVICE_FOLDERS: readonly ServiceFolder[] = (() => {
  const byPath = new Map<string, Set<string>>();

  for (const source of WIZARD_SOURCES) {
    if (source.inboxPath == null || !source.importerReady) {
      continue;
    }

    const importers = byPath.get(source.inboxPath) ?? new Set<string>();

    importers.add(source.importer ?? source.id);

    for (const also of source.alsoImporters ?? []) {
      importers.add(also);
    }

    byPath.set(source.inboxPath, importers);
  }

  return [...byPath].map(([folder, importers]) => ({
    path: folder,
    segments: folder.split('/'),
    importers,
  }));
})();

/**
 * The folders the inbox should offer: the TOP-LEVEL segment of each
 * `inboxPath`, deduplicated — `google-takeout`, `apple`, `amazon`, `reddit`.
 *
 * Only the top level, even where the guides name deeper paths
 * (`google-takeout/Mail`): the per-product subfolders would ask the user to
 * know what is inside their archive, and a Takeout usually holds several
 * products at once. Dropping it in `google-takeout/` is the whole statement —
 * the ancestor rule in {@link declaredSourcesForInboxUnit} turns that into
 * every importer under the folder, exactly like the wizard's bundle card.
 * Deeper paths still MATCH if someone recreates them by hand; they are just
 * not created.
 */
export function serviceInboxFolders(): readonly string[] {
  return [...new Set(SERVICE_FOLDERS.map((folder) => folder.segments[0]))];
}

/**
 * The importers a unit's inbox location declares, or null for the root.
 *
 * A folder matches a unit two ways, both compared segment-wise and
 * case-insensitively (the folders are authored lowercase; a hand-typed
 * `Amazon/` must not silently mean something different):
 *
 *  - the unit sits AT or UNDER the folder — `amazon/orders.zip`, and the
 *    whole-folder case where `amazon/` itself is the unit;
 *  - the unit IS or sits in an ANCESTOR of the folder — the `google-takeout`
 *    folder-unit, or a Takeout zip dropped inside it, matches every
 *    `google-takeout/<product>` path, so the drop declares the bundle the
 *    same way the wizard's Google card does. The unit-is-ancestor case
 *    matters because some ecosystems (Google, Microsoft, Apple) have ONLY
 *    nested inboxPaths: without it the top-level folder unit itself declared
 *    nothing at all.
 *
 * Ancestor matching over-declares by design (a unit in `apple/messages/` also
 * declares `apple/photos`'s importer): declaration only bounds what detection
 * may credit, so an importer the archive never fed credits nothing. A unit at
 * the inbox root matches nothing and returns null — the undeclared,
 * dominant-source behavior.
 */
export function declaredSourcesForInboxUnit(unitRelPath: string): string[] | null {
  const unit = unitRelPath.split('/').map((segment) => segment.toLowerCase());
  const parent = unit.slice(0, -1);
  const declared = new Set<string>();

  for (const folder of SERVICE_FOLDERS) {
    const segments = folder.segments.map((segment) => segment.toLowerCase());

    const underFolder =
      segments.length <= unit.length && segments.every((segment, index) => segment === unit[index]);
    const unitIsAncestor =
      unit.length < segments.length && unit.every((segment, index) => segment === segments[index]);
    const parentIsAncestor =
      parent.length > 0 &&
      parent.length < segments.length &&
      parent.every((segment, index) => segment === segments[index]);

    if (underFolder || unitIsAncestor || parentIsAncestor) {
      for (const importer of folder.importers) {
        declared.add(importer);
      }
    }
  }

  return declared.size > 0 ? [...declared].sort() : null;
}
