# Spike: Webbed Feet-inspired graph view

Branch: `spike/webbed-feet-graph-view`

Replaces the `/memory?view=graph` presentation with a full-bleed SVG graph modelled on the
Webbed Feet explore page: an animated force layout the viewer manipulates directly, floating
dialogs over the canvas instead of panels below it, camera flights on selection, an explicit
focus mode per entity, and selectable connection threads. The PostgreSQL graph read APIs are
unchanged and remain the source of truth.

## Data contract (unchanged)

- `GET /api/graph/data` — bounded overview payload, with the explorer's shared URL filters
  (`includedEntityTypes`/`excludedEntityTypes`, `tags`, `connectors`, `people`, `places`,
  `eventTypes`, `hasLocation`, `from`/`to`) forwarded exactly as before via `useGraphOverview`.
- `GET /api/graph/node` — entity-centred expansion via `useNodeGraphService` (focus mode).
- `GET /api/graph/search` — search-scoped subset, still honouring the shared explorer filters.
- `GET /api/graph/context` — owner entity id (used to anchor/centre the overview).

The `{ nodes, links }` graph shape and the server-side caps/filter contract are untouched.

## Interaction model

| Gesture | Result |
| --- | --- |
| Click a node | Camera flies to it; entity info dialog opens (name, type, description, properties, connections, actions) |
| Info dialog → Focus | Enters focus mode: the node's subgraph from `GET /api/graph/node` replaces the overview, with a visible "Overview" return control. The entity's own connections draw at full weight; the neighbourhood one and two hops beyond stays on screen as receding, unlabelled context dots (`focusHops`), still hoverable and clickable |
| Click a link | Connection-thread selection: the relationship is emphasised, everything else recedes, and a thread dialog opens (type, direction, strength, metadata) |
| Click empty canvas | Clears selection and closes dialogs; camera flies back to the fitted overview frame |
| Hover a node | Its one-hop neighbourhood stays lit, the rest dims (pre-existing behaviour, retained) |
| Drag / wheel on canvas | Pan and zoom (pre-existing, retained); manual input cancels a camera flight in progress |
| Drag a node | The node pins to the pointer and the web re-tensions around it (`alpha(0.1)` reheat per move, ported from Webbed Feet's `dragged()`); it stays pinned where dropped |
| Drag a dialog | The floating cards drag by their header and glide with throw momentum, bouncing softly off the shell edges |

## Retained from the old graph view

- Route and view slot (`/memory?view=graph`, the `graph` tab in Memory hub, desktop + mobile).
- Explorer URL filter integration: entity types, tags, event-scoped dimensions, date range and
  search all still scope the graph, shared with List/Gallery/Map.
- `ForceGraph` as the single SVG layout/render layer. Its motion model is now a direct port of
  Webbed Feet's `force-graph-experiment.ts`: a real `d3-force` simulation (charge, collision,
  strength-based link distances, gentle x/y centering) with the slow `alphaDecay(0.04)` settle,
  ticking straight into the DOM with zero React re-renders per frame. Label budget and collision
  behaviour are unchanged and the existing test suite still passes.
- Type-based node colours from `entityVisuals` (LifeScope palette), now also surfaced as a
  floating legend.
- The shared EntityDetails sheet: the info dialog's "Details" action calls `setActiveEntity`,
  same as the old node click did.
- Empty/error/loading states, including the filter-aware empty-state messaging.

## Removed in this spike (deliberate)

- **3D view** (`ForceGraph3D` and the 2D/3D toggle). The component still exists for other
  callers; the memory graph no longer offers it.
- **Neighbors spawn-limit input** — superseded by fixed bounds: the overview shows the bounded
  `/data` payload capped to the 150 busiest nodes, and focus mode uses a 60-node / 3-hop budget
  (1 hop at full weight + a 2-hop context ring).
- **Hop-depth slider** — same replacement as above.
- **Anchor toggle** (pinning previously visible nodes across relayouts).
- **Traversal toggle** (re-centring the layout on the last-clicked node).
- **Click-count neighbour spawning** — clicking a node no longer incrementally reveals more of
  its neighbours; focus mode is the explicit replacement for "show me more around this node".
- **In-graph node-type / relationship-type chip rows** — the explorer toolbar's shared entity-
  type filter still applies; the graph-local chip toggles do not. The legend is informational.
- **Summary / entity-details panels below the canvas**, including the account-wide quick stats
  (`/api/graph/context` totals). The context endpoint is still called for the owner entity id.
- **Search results merging into the interactive overview** — search mode now shows the search
  subset on its own rather than overlaying it on the click-expanded graph.

## Deferred follow-ups

- Relationship-type filtering in the new model (e.g. a legend that toggles).
- Multi-node connection threads (shortest path between two arbitrary nodes; today a thread is a
  single selected relationship).
- Focus-mode depth control (fixed at 2 hops for the spike).
- Mobile-specific dialog placement (cards currently anchor top-right on all sizes).
- Zoom-threshold label presentation (Webbed Feet swaps dots for label pills past zoom 1.5; we
  keep the degree-based standing-label budget at all zoom levels).
- Restoring account-wide quick stats somewhere outside the canvas if they are missed.

## Files

- `frontend/apps/web/src/pages/MemoryPage/GraphView/GraphExplorerModal.tsx` — the new shell
  (mode state machine: overview / focus / search; selection; floating chrome).
- `frontend/apps/web/src/pages/MemoryPage/GraphView/EntityInfoDialog.tsx` — entity info card.
- `frontend/apps/web/src/pages/MemoryPage/GraphView/ConnectionThreadDialog.tsx` — thread card.
- `frontend/apps/web/src/components/ForceGraph/ForceGraph.tsx` — the Webbed Feet motion port:
  `d3-force` simulation with slow settle, imperative per-tick DOM writes, node dragging with
  re-tension, camera that tracks the settling layout, dashed weak ties, plus link selection,
  background click and camera flights (`selectedLinkId`, `onLinkSelect`, `onBackgroundClick`,
  `flyToNodeId`).
- `frontend/apps/web/src/pages/MemoryPage/GraphView/useThrowableCard.ts` +
  `throwPhysics.ts` — dialog drag with throw momentum.
