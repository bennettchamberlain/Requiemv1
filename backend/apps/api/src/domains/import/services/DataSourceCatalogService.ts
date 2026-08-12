import { Injectable } from '@nestjs/common';

// Importing the barrel REGISTERS every parser as a side effect — that is what
// populates the registry this service reads. It is imported here and nowhere
// else on the API path, so the cost is paid once, in the one place that needs
// the catalog to be complete. `domains/import/index.ts` deliberately does not
// re-export it for the same reason.
import '../datasources';
import { allDataSources, type DataSource } from '../datasources/registry';

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

function toSummary(source: DataSource): DataSourceSummary {
  return {
    name: source.name,
    title: source.title,
    description: source.description,
    icon: source.icon,
    stub: source.stub === true,
    supportsFiles: source.newFileImporter != null,
    supportsApi: source.newAPIImporter != null,
  };
}
