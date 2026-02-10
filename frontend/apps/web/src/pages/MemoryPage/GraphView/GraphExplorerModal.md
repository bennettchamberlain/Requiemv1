# GraphExplorerModal.tsx

## Purpose
Renders the interactive memory knowledge graph panel for the Memory page, including 2D/3D graph rendering, node detail inspection, search integration, and local graph exploration controls. This file owns the client-side visibility model that decides which nodes and links are shown as users expand the graph, including bounded N-hop traversal (default depth: 2).

## Components

### `GraphTabPanel`
- **Does**: Coordinates graph data loading, search-mode data merging, filtering, traversal controls (neighbors-per-click and hop depth), and the final graph/detail UI.
- **Interacts with**: `useGraphOverview` from `/Users/max/Code/CompInt/CI-Server/frontend/apps/web/src/api/useGraphOverview.ts`, `ForceGraph` and `ForceGraph3D` from `/Users/max/Code/CompInt/CI-Server/frontend/apps/web/src/components/ForceGraph/ForceGraph.tsx` and `/Users/max/Code/CompInt/CI-Server/frontend/apps/web/src/components/ForceGraph/ForceGraph3D.tsx`.
- **Rationale**: Keeps graph exploration behavior (selection, expansion, filtering, centering, anchoring) in one component so user interactions remain consistent across rendering modes.

### `getTypeColor`
- **Does**: Maps entity types to deterministic colors used by badges and graph styling.
- **Interacts with**: `TYPE_COLOR_PALETTE` and entity metadata from graph nodes.
- **Rationale**: Ensures stable visual identity across rerenders without requiring backend-provided colors.

### `resolveEndpointId`
- **Does**: Normalizes link endpoint values to string IDs when endpoints may be primitive IDs or objects.
- **Interacts with**: Link payloads from API and graph renderer structures.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `/Users/max/Code/CompInt/CI-Server/frontend/apps/web/src/pages/MemoryPage/GraphView/GraphView.tsx` | `GraphTabPanel` renders the full graph experience for desktop/mobile variants | Renaming/removing `GraphTabPanel` export or changing `variant` semantics |
| `/Users/max/Code/CompInt/CI-Server/frontend/apps/web/src/components/ForceGraph/ForceGraph.tsx` | Receives filtered `nodes` and `links` plus selection callbacks | Changing node/link shape or callback contracts |
| `/Users/max/Code/CompInt/CI-Server/frontend/apps/web/src/components/ForceGraph/ForceGraph3D.tsx` | Receives the same graph contract as 2D mode | Diverging 2D/3D props unexpectedly |
| `/Users/max/Code/CompInt/CI-Server/backend/apps/api/src/domains/memory/controllers/GraphController.ts` | Search endpoint returns node/link structures compatible with this component’s mapping | API response shape changes without frontend mapping updates |

## Notes
- Expansion is intentionally bounded by local controls to avoid rendering overly dense neighborhoods at once.
- Hop depth uses `- / +` controls with a default of `2` and bounded range to keep rendering stable.
- Search mode merges search hits into the base graph data and preserves filtering/selection behavior.
