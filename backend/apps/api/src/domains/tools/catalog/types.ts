/**
 * The published CI Intent catalog shape — the discoverable, typed capability declaration.
 *
 * Every tool is an intent, so the catalog is entirely tool metadata: it describes how the tools
 * registered in this domain are published (over REST via the agent-domain controller and over MCP
 * as the `intents://catalog` resource).
 */

import type { CiEntityType, IntentDomainKey, IntentPrivacy, JSONSchema } from '../core/types';
import type { DispatchRuling, DispatchTier } from '../policy/dispatchPolicy';

/**
 * Display descriptor for a schema domain — the standardized verb vocabulary tools are grouped
 * under, so agents and apps speak the same language.
 */
export interface IntentDomain {
  key: IntentDomainKey;
  title: string;
  description: string;
}

/**
 * Display + identity descriptor for an entity type. Published in the manifest so agents can
 * render and resolve entities uniformly.
 */
export interface CiEntityDescriptor {
  type: CiEntityType;
  title: string;
  description: string;
  idKind: 'uuid' | 'global-uid';
}

/** A tool flattened for publication: its dotted intent name plus its executable tool name. */
export interface ManifestIntent {
  name: string;
  tool: string;
  domain: IntentDomainKey;
  title: string;
  description: string;
  parameters: JSONSchema;
  privacy: IntentPrivacy;
  /**
   * Whether the on-device tier can serve this intent from local data (see
   * `IntentDefinition.localCapable`).
   *
   * Published so a client can gate its UI without asking the appliance — which is the only way it
   * *can* ask while offline. Paired with `privacy.destructive` / `privacy.external`, it is the
   * complete input to the shared `resolveDispatch` rule, so the on-device dispatcher runs the
   * server's policy rather than a second copy of it.
   */
  localCapable: boolean;
  consumes: CiEntityType[];
  produces: CiEntityType[];
  phrases: string[];
  /**
   * The server's own `resolveDispatch` ruling for the tier the caller asked about, present only
   * when the request named a tier (`GET /api/intents?tier=local`).
   *
   * This exists so the on-device dispatcher never re-derives the rule. `localCapable` + `privacy`
   * are *sufficient* to compute it, but "sufficient input" still means two more implementations —
   * one in Kotlin, one in Swift — of a rule whose own docs warn that "two copies of a security
   * rule are two rules". Publishing the decision keeps the copy count at one: native code reads
   * `dispatch.decision` and branches, and a policy change ships with the appliance rather than
   * waiting on two app-store releases.
   */
  dispatch?: DispatchRuling;
}

/**
 * The discoverable capability declaration — a pre-declared, typed catalog of the available
 * intents. Served at `GET /api/intents` and as an MCP resource so every harness reads one typed
 * catalog.
 */
export interface IntentManifest {
  version: string;
  generatedAt: string;
  domains: IntentDomain[];
  entities: CiEntityDescriptor[];
  intents: ManifestIntent[];
  /** Echoes the tier the rulings in `intents[].dispatch` were computed for, when one was asked for. */
  tier?: DispatchTier;
}
