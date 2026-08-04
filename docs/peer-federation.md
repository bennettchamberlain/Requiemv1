# Peer federation: asking questions across Companion memories

> Two Companion Memory boxes exchanging questions, discovered through CI-Portal.
> Feature flag: **`ask`** (off by default). Tracking: [CI-Server #1711](https://github.com/companionintelligence/CI-Server/issues/1711) → epic #1712.

Most questions between people are really queries against the other person's memory — *"do you have photos of us?"*, *"do you know anyone at Acme?"*, *"free for lunch Friday?"*. Today those run over the worst possible protocol: interrupt the human, wait, hope they remember, get an unsourced answer.

Peer federation replaces that with:

> **human intent → standardized ask → the other person's Companion → consent gate → truthful, filtered answer**

The human stays in the loop exactly where they add value (consent, redaction) and leaves it where they don't (searching, remembering, compiling). That is what makes automated personal assistants possible without handing an assistant a copy of everyone's data.

---

## The shape of it

```
   Asker's box                 CI-Portal                  Responder's box
  ┌───────────┐            ┌──────────────┐             ┌───────────────┐
  │ Companion │──resolve──▶│  directory   │             │   Companion   │
  │           │◀─endpoint──│ (phone book) │             │               │
  │           │            └──────────────┘             │               │
  │           │─────── POST /agent/v1/ask ─────────────▶│  consent gate │
  │           │◀────── filtered answer ─────────────────│  run-as-owner │
  └───────────┘                                         └───────────────┘
```

**CI-Portal is a phone book, not a social network.** It answers exactly one question — *"who is `@handle`, where does their Companion listen, and what OIDC identity will they present?"* It stores **no** relationships, grants, asks, or answers. Those live only on the two boxes involved, so the cloud plane never accumulates the social graph.

## The three archetypes

Each is a separate wire shape, so a peer cannot smuggle a retrieval through an availability request. The asker names an **archetype and its constraints** — never a query over the responder's schema — so a peer can't probe storage layout either.

| Question | Archetype | Answer form | What crosses the wire |
|---|---|---|---|
| "Do you know X?" | `relationship` | boolean | yes/no — **no item references** |
| "Have you seen X content?" | `content` | existence | count/summary — **no item references** |
| "Free for lunch Friday at X?" | `availability` | free/busy | **interval boundaries only** |

Shape and vocabulary follow OID4VP/DCQL's "request specific claims, get a selectively-disclosed response" model rather than a datastore query. See [`domains/peers/protocol.ts`](../backend/apps/api/src/domains/peers/protocol.ts).

## Availability, and why it can answer itself

`computeFreeBusy()` ([`domains/peers/availability.ts`](../backend/apps/api/src/domains/peers/availability.ts)) is a pure function with an explicit disclosure contract:

- Output contains **only interval boundaries**. Titles, descriptions, locations, attendees, and event ids never appear.
- Overlapping and adjacent busy blocks are **merged**, which destroys the "how many meetings" signal as well.
- `minMinutes` filters the returned free slots, so *"free for lunch?"* doesn't come back with a useless 5-minute gap.

Because the output is provably free/busy only, an availability ask is **safe to auto-answer under a standing grant** — no human interruption. That is the unlock for agent-to-agent scheduling: two assistants can find a lunch slot without either seeing the other's calendar.

## The inbound pipeline

`POST /agent/v1/ask` is the **only** route another Companion can reach.

```
verified (iss,sub) → peer link → ask record → grant evaluation
   → auto ?  execute run-as-owner + disclosure filter  :  owner's review inbox
```

Everything after the peer-link step is the machinery Phases 0–1 already built and tested. **Federation adds a transport and an identity, not a second policy engine.**

The route deliberately does **not** use `JwtOrApiKeyAuthGuard`: its portal path JIT-provisions a local user, which is exactly what must not happen for a peer. It calls `verifyClaims()` instead — verify, never provision.

## Security properties

| Property | How it holds |
|---|---|
| **No shadow accounts** | Inbound asks use `verifyClaims()`; a peer never mints a local user on a box it can merely reach. |
| **No cross-box account takeover** | Users bind on OIDC **`(issuer, subject)`**, never `email`. Email is re-assignable and not unique across issuers, so matching on it once a second issuer is trusted hands the account to whoever controls that address. Email survives only as a **one-time** link, gated on `email_verified`. |
| **Unlinked = refused** | An ask from an unknown or revoked peer is rejected without detail; a stranger can't distinguish "no such user here" from "you aren't linked". |
| **Revocation is immediate** | Only `status='active'` links match, so revoking takes effect on the very next ask. |
| **No existence oracle** | Declines and pending-review responses are shaped identically to "nothing found". |
| **Hostile input** | Bodies are zod-validated against the archetype union and rejected off-contract. Peer *responses* are equally untrusted — `PeerAskClient.normalize()` carries forward only recognized fields and degrades an unknown status to `declined`. |
| **No enumeration** | Portal search returns only opt-in `discoverable` entries; resolution requires an exact handle. |
| **Bounded blast radius** | Every outbound call is timeout-bounded; a slow or hostile peer degrades to `declined` rather than hanging the caller. |

## Data model

| Table | Holds |
|---|---|
| `ci.federated_identities` | `(issuer, subject) → user`, the binding key. `bind_method` records `sub` vs one-time `email_link`. |
| `ci.peer_links` | The local half of the trust graph: handle, endpoint, peer `(iss,sub)`, trust tier, revocation, and `person_entity_id` — the person in *your* memory this peer is (what makes "do you know X?" resolvable). |
| `ci.asks` | Gains `peer_link_id` + `direction`. `asker_user_id` is **nullable** with a CHECK that exactly one of `(asker_user_id, peer_link_id)` identifies the asker — an inbound ask has no local asker. |
| `ci.ask_grants` | Gains `grantee_peer_link_id` (exactly-one CHECK) so consent can address a peer, not just a household member. |
| `ci.ask_audit` | Records the peer **FK-lessly**, matching its durability contract: removing a peer must not erase the record of what was disclosed to them. |

## Configuration

```jsonc
// backend/apps/api/config/default.json
"peers": {
  "directoryUrl": "",      // CI-Portal peer-discovery base; empty disables discovery
  "memoryEndpoint": "",    // this box's own /agent/v1, published to the directory
  "handle": "",            // this box's Portal handle
  "timeoutMs": 10000       // bound on every outbound peer/directory call
}
```

Env: `CI_PEER_DIRECTORY_URL`, `CI_PEER_MEMORY_ENDPOINT`, `CI_PEER_HANDLE`, `CI_PEER_TIMEOUT_MS`.
The inbound surface is additionally gated by the **`ask`** feature flag (`ENABLE_ASK`), off by default.

## Status

Inbound is complete: a box can **receive, gate, and answer** a federated ask end-to-end. The **outbound** composer (`PeerAskClient` + `PeerDirectoryService`) is implemented and unit-tested but not yet wired to a UI or agent surface, so a box cannot yet *send* an ask outside of tests. Peer-link management UI and the MCP tool for assistants are the next increment.

## See also

- Design: [`CI-Engineering/projects/decentralized-trust-graphs/`](https://github.com/companionintelligence/CI-Engineering/tree/main/projects/decentralized-trust-graphs) (PRD · ARCHITECTURE · ROADMAP · USE-CASES · UX)
- The intra-box ask this inverts: [`saved-search-sharing.md`](saved-search-sharing.md)
