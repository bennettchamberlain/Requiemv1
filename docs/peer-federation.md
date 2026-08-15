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
| **No SSRF** | Every server-side fetch passes `checkEgressUrl()`: https only, no credentials, no non-standard ports, no private/loopback/link-local/CGNAT/metadata address — including IPv4-mapped IPv6 in **both** spellings, since `URL` normalizes `::ffff:10.0.0.1` to hex. |
| **Token can't be replayed at another box** | The peer surface verifies the token against **this box's own `peers.audience`**, not the broad first-party list. It refuses to accept anything until that is configured. |
| **Inbound flooding is bounded** | `PeerRateLimitService` limits on the verified `(issuer, subject)` **before** the peer-link lookup, so an unknown caller is limited too. |
| **Timezone-independent availability** | All-day events expand on **UTC** day boundaries, so two boxes in different zones compute identical busy spans. |

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
  "audience": "",          // REQUIRED for inbound: the audience Portal mints for THIS box
  "timeoutMs": 10000       // bound on every outbound peer/directory call
}
```

Env: `CI_PEER_DIRECTORY_URL`, `CI_PEER_MEMORY_ENDPOINT`, `CI_PEER_HANDLE`, `CI_PEER_AUDIENCE`, `CI_PEER_TIMEOUT_MS`.
The inbound surface is additionally gated by the **`ask`** feature flag (`ENABLE_ASK`), off by default.

> **`peers.audience` is not optional for inbound.** Without it, a token issued for *any* first-party client would verify here — including one minted for a different Companion. The peer route refuses every request until it is set, rather than falling back to the broad list.

## Known limitations

- **DNS rebinding** is not closed. `checkEgressUrl` validates the literal host, but a hostname that resolves to a private address at connect time would still be fetched; pinning the resolved IP through the socket is not something Node's `fetch` exposes. The residual exposure is bounded by requiring https, so the target must present a valid certificate for the name.
- **Rate limits are per-process and in-memory.** Correct for a single-instance appliance; a shared store is needed before the ask path goes multi-instance.
- **The peer access token is supplied by the caller**, not minted here, until Portal token exchange lands.

## Sending an ask (outbound)

`OutboundAskService` + the `sendPeerAsk` GraphQL mutation are the outbound half. The two directions are deliberately separate services: **inbound** treats the ask as hostile and the local owner as authoritative; **outbound** treats the local user as authoritative and the **peer's response** as untrusted. Conflating them would blur which side of the trust boundary each piece of data came from.

Two details worth knowing:

- The local `Ask` row is written **before** the request leaves, so an outbound ask is auditable even when the peer never answers — a peer that goes silent still leaves a record that this box asked.
- A **fresh correlation id** is sent per ask, never the local row id, which would leak this box's identifiers to the peer.

An unknown handle and a revoked link are refused **identically**, so a caller cannot use the error to discover which handles the owner has ever been linked to.

### The token

`sendPeerAsk` takes a `peerAccessToken` — a Portal-issued token whose audience is the **peer** box. Until Portal token exchange (RFC 8693) lands, the caller supplies it; this box never mints or caches one. The peer verifies that binding on receipt, which is what stops a token for one box being replayed at another.

## Status

**Both directions work.** A box can receive, gate, and answer a federated ask, and can compose and send one. Still open: peer-link management UI, an MCP tool so assistants can drive asks directly, and Portal token exchange so the access token is minted rather than passed in.

## See also

- Design: [`CI-Engineering/projects/decentralized-trust-graphs/`](https://github.com/companionintelligence/CI-Engineering/tree/main/projects/decentralized-trust-graphs) (PRD · ARCHITECTURE · ROADMAP · USE-CASES · UX)
- The intra-box ask this inverts: [`saved-search-sharing.md`](saved-search-sharing.md)
