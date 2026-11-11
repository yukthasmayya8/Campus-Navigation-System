# Research Implementation Mapping

## Status of research papers
The prompt states: "I have collected 18 research papers." However, **no PDF or research paper files are present in this repository** (searched for `*.pdf`, `*research*` in the workspace; only this mapping file and project docs exist). 

Because the source papers are unavailable in-repo, this document **does not fabricate paper titles, authors, venues, or specific quoted limitations**. Instead, it maps commonly reported limitations in campus/pedestrian navigation research to the concrete features implemented in this system, and specifies how each can be demonstrated. If the 18 papers are provided later, each row should be updated with the exact source paper citation and the verbatim/accurate limitation from that paper.

## Mapped limitations and implemented solutions

| # | Source paper | Limitation (from paper) | Implemented solution in this codebase | Demonstration method |
|---|---|---|---|---|
| 1 | **Not provided in repository** (replace with actual citation) | Limited/offline navigation support when network is unavailable | Frontend caches active locations and published routes via IndexedDB (`frontend/src/lib/offline.js`), syncs from `/api/offline/snapshot`, and falls back to cached search/routes/nearest when network requests fail (`frontend/src/api.js`). Service worker caches app shell and viewed map tiles (`frontend/public/sw.js`). UI shows offline status bar and cache timestamp. | Build/preview or serve app, load data once online, then go offline in DevTools and show: locations/routes still load from cache, route finding uses saved routes, offline indicator appears. Note: rerouting uses cached/server logic as available; server-side rerouting while fully offline is not claimed. |
| 2 | **Not provided in repository** (replace with actual citation) | Poor GPS tracking quality (noise, jumps, low accuracy) causing unstable guidance | `GpsFilter` in `frontend/src/lib/geo.js` rejects fixes with accuracy > 30 m, drops physically impossible jumps (speed threshold), and smooths with accuracy-weighted averaging. `PathTracker` (`frontend/src/lib/tracker.js`) uses filtered fixes for distance-to-path, remaining distance, off-route and arrival detection. UI displays GPS accuracy indicator and weak-signal messages. | Run navigation on a device or simulate geolocation; observe low-accuracy fixes reported/waited on, jump filtering messages, stable position marker, and accuracy readout in nav panel. |
| 3 | **Not provided in repository** (replace with actual citation) | Lack of automatic rerouting/off-route recovery | Off-route detection triggers after >30 m deviation for 3 consecutive filtered fixes (`PathTracker`, `frontend/src/lib/tracker.js`). Public navigation offers reroute: first tries another verified alternative passing current position, else finds nearest building via `/locations/nearest` (or offline fallback) and offers recorded routes to destination (`frontend/src/pages/PublicPage.jsx`). | During navigation, move/simulate position >30 m from route for 3 fixes to see off-path warning and "Find another route"; verify it switches to a passing alternative or proposes routes from nearest building. |
| 4 | **Not provided in repository** (replace with actual citation) | Coarse/building-level navigation and lack of route alternatives/metadata | Backend stores and serves recorded pedestrian route geometries, waypoints, bidirectional reverse routes, and accessibility-related metadata (stairs/ramp/covered, nullable = not verified) with sorting (`backend/src/services/routes.js`). Frontend shows multiple alternatives with distance/ETA, metadata chips, next waypoint/destination, snap-to-route marker, follow-me, and arrival screen. | Select start/destination with multiple published routes; compare alternatives and metadata, start navigation to see next waypoint, remaining distance, snap/follow behavior, and arrival screen at destination. |

## Additional implemented improvements (supporting research goals)
- **Accessibility information:** Route metadata fields `hasStairs`, `hasRamp`, `isCovered` (verified yes/no or not verified) displayed to users and manageable in admin.
- **Building-level navigation:** Seeded/managed campus buildings with coordinates, descriptions, images; nearest-building detection for start selection and rerouting.
- **Reliable route/version management:** Draft/publish workflows, version history, Super Admin restore, optimistic locking with HTTP 409 `VERSION_CONFLICT` (`backend/src/services/locations.js`, `backend/src/services/routes.js`).
- **Live route recording:** GPS-filtered recording with batching and waypoint capture (`frontend/src/pages/AdminRecorder.jsx`).

## Demonstration checklist
1. **Offline:** load app online → confirm "Offline data saved" → toggle offline → search and find saved routes.
2. **GPS quality:** start navigation → check accuracy indicator and weak-signal/jump handling.
3. **Off-route & reroute:** deviate >30 m for 3 readings → use reroute action.
4. **Building-level guidance:** choose SMVITM buildings → view alternatives, metadata, waypoints, arrival.

## Note on citations
When the 18 papers are added to the repository, update column "Source paper" with full citations (authors, year, title, venue/DOI if available) and replace the placeholder limitation text with the specific limitation stated in each paper. No research findings were invented for this mapping.
