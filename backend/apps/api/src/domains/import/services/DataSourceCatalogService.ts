import { Injectable } from '@nestjs/common';

// Importing the barrel REGISTERS every parser as a side effect — that is what
// populates the registry this service reads. It is imported here and nowhere
// else on the API path, so the cost is paid once, in the one place that needs
// the catalog to be complete. `domains/import/index.ts` deliberately does not
// re-export it for the same reason.
import '../datasources';
import { allDataSources, type DataSource } from '../datasources/registry';
import { WIZARD_SOURCES, type WizardSource } from '../sources/guides';

/** One importer, as the catalog describes it. */
export interface DataSourceSummary {
  /** Stable snake_case id. This is what `staged_items.data_source` records. */
  name: string;
  title: string;
  description: string;
  /** Icon filename the frontend resolves; not a URL. */
  icon: string;
  /**
   * Recognized but not yet implemented. Listed rather than hidden so someone
   * looking for their export learns the appliance knows about it, instead of
   * concluding it is unsupported and giving up.
   */
  stub: boolean;
  /** Can read an export off disk — the archive-import path. */
  supportsFiles: boolean;
  /** Can pull from a live account, given credentials. */
  supportsApi: boolean;
  /**
   * How to get this export out of the service that holds it.
   *
   * The reason someone is on the import page at all is usually that they do not
   * know where their data lives. Shipping the instructions with the catalog puts
   * the answer where the question is asked, instead of in documentation they
   * would have to go looking for.
   */
  guide: SourceGuide | null;
}

/** The authored export instructions for one source. */
export interface SourceGuide {
  title: string;
  blurb: string;
  ecosystem: string;
  category: string;
  /** Roughly how long between requesting the export and being able to download it. */
  wait: string;
  /** How the export is obtained: web-export, app-export, local-file, manual-upload, api. */
  acquisition?: string;
  /** Deep link to the export page, when the service has a stable one. */
  url?: string;
  stepsTitle?: string;
  steps: string[];
  /** A second way to get the data, when the service offers one with different tradeoffs. */
  altPath?: { title: string; url?: string; steps: string[] };
  /** What the importer actually reads once the archive is open. */
  expectedFormat?: string;
  /** What lands in the timeline from this source. */
  whatImported?: string[];
  /** Worth knowing BEFORE spending an hour exporting. */
  caveats?: string[];
  /** Loose addenda, rendered without a heading. */
  notes?: string[];
}

/**
 * What this appliance can import.
 *
 * Read from the in-memory registry rather than a table: the registry IS the
 * source of truth for what can be imported, and a catalog table would be a
 * second copy that drifts the first time someone adds a parser without a
 * migration.
 */
@Injectable()
export class DataSourceCatalogService {
  /** Every registered importer, ordered by name. */
  list(): DataSourceSummary[] {
    return allDataSources().map(toSummary);
  }

  /** One importer by its stable name, or null. */
  find(name: string): DataSourceSummary | null {
    const match = allDataSources().find((source) => source.name === name);

    return match ? toSummary(match) : null;
  }
}


/**
 * Guides indexed by the importer they feed.
 *
 * A guide names its importer explicitly when they differ — several sources share
 * the `generic` parser, and an ecosystem's one export can feed more than one
 * importer (an Apple Contacts archive resolves to both `vcard` and
 * `apple_contacts`). Built once: the registry does not change at runtime.
 */
const GUIDES_BY_IMPORTER = new Map<string, WizardSource>(
  WIZARD_SOURCES.flatMap((source) => {
    const keys = [source.importer ?? source.id, ...(source.alsoImporters ?? [])];

    return keys.map((key) => [key, source] as const);
  }),
);

function toGuide(source: WizardSource | undefined): SourceGuide | null {
  if (source == null) {
    return null;
  }

  return {
    title: source.title,
    blurb: source.blurb,
    ecosystem: source.ecosystem,
    category: source.category,
    wait: source.wait,
    acquisition: source.acquisition,
    url: source.url,
    stepsTitle: source.stepsTitle,
    steps: source.steps,
    altPath: source.altPath,
    expectedFormat: source.expectedFormat,
    whatImported: source.whatImported,
    caveats: source.caveats,
    notes: source.notes,
  };
}

function toSummary(source: DataSource): DataSourceSummary {
  return {
    name: source.name,
    title: source.title,
    description: source.description,
    icon: source.icon,
    stub: source.stub === true,
    supportsFiles: source.newFileImporter != null,
    supportsApi: source.newAPIImporter != null,
    guide: toGuide(GUIDES_BY_IMPORTER.get(source.name)),
  };
}
