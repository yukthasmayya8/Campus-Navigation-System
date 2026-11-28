# SMVITM Campus Navigation System

A full-stack campus navigation platform for **Shri Madhwa Vadiraja Institute of Technology and Management (SMVITM), Bantakal, Karnataka**.

The system provides building discovery, verified pedestrian-route alternatives, live GPS guidance, an administrator console, offline public reads, and version-controlled campus data.

[![Backend](https://img.shields.io/badge/Backend-Render-46E3B7)](https://campus-navigation-system-5bj3.onrender.com/api/health)
[![Frontend](https://img.shields.io/badge/Frontend-Netlify-black)](https://campus-navigation-system-smvitm.netlify.app)
[![Database](https://img.shields.io/badge/Database-Neon%20%2B%20PostGIS-00A6FF)](https://neon.com/)
[![License](https://img.shields.io/badge/License-Private-red)](#license)

## Project summary

The SMVITM Campus Navigation System is a browser-based pedestrian navigation application designed around **published, GPS-recorded campus routes**.

Students and visitors can find campus buildings, choose a start and destination, compare route alternatives, follow a live position on the map, and use previously downloaded public data while offline. Administrators can record real walking paths, manage buildings and route metadata, publish verified routes, review history, and manage accounts.

The system does not infer paths from roads or building coordinates. Approved route recordings are the source of truth: building-to-building route alternatives match those published recordings, while GPS-origin planning can search a graph assembled only from published route geometry.

## Table of contents

- [Feature overview](#feature-overview)
- [How features work](#how-features-work)
- [Navigation implementation status](#navigation-implementation-status)
- [Algorithms used](#algorithms)
- [Architecture](#architecture)
- [Data model](#data-model)
- [API security](#api-security)
- [Technology stack](#technology-stack)
- [Live deployment](#live-deployment)
- [Local development](#local-development)
- [Database setup](#database-setup)
- [Seed accounts](#seed-accounts)
- [Testing](#testing)
- [Production deployment](#production-deployment)
- [Security](#security)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [Project team](#project-team)
- [License](#license)

## Feature overview

| Area | Public feature | Administrative feature |
| --- | --- | --- |
| Building discovery | Search active campus buildings, view details, and locate the nearest building | Create, update, activate, deactivate, and upload images for buildings |
| Route planning | Compare published routes between selected buildings | Record GPS tracks, create drafts, add waypoints, and publish routes |
| Navigation | Track the device against a selected recorded polyline, receive off-path or arrival feedback, and review confirmation-only recovery paths | Preview gaps and route metadata before publishing |
| Accessibility | View stairs, ramp, covered-path, and waypoint information | Set and verify accessibility metadata |
| Offline use | Search cached buildings and browse cached route alternatives | Not available for writes or administration |
| Data governance | Read only the current active public state | Manage versions, restore snapshots, and review audit logs |
| Accounts | Log in, change passwords, and request password resets | Manage Admin/Super Admin users and account status |

### Public users

- Interactive Leaflet campus map
- Building search and category filtering
- Nearest-building detection from browser GPS and route planning from a current position
- Multiple published route alternatives
- Step, ramp, covered-path, and waypoint metadata
- Live position tracking and off-path alerts
- Recorded-route navigation with arrival detection and user-confirmed alternatives
- IndexedDB and service-worker offline support

### Administrators

- Admin and Super Admin role separation
- Cookie-based JWT authentication
- Force-password-change support
- Location creation, editing, activation, and deactivation
- GPS route recording and batch point uploads
- Route publishing and lifecycle management
- Location and route version history
- Super Admin restoration and account management
- Audit-log review

## How features work

### Public building discovery

The public application loads active locations from `GET /api/locations` and renders them as Leaflet markers. Search uses `GET /api/locations/search?q=<text>&limit=<count>` and performs PostgreSQL `ILIKE` matching. Prefix matches are ranked ahead of substring matches, and duplicate or stale records are never expected in the public view because only active locations are returned.

The location detail screen obtains a selected building from `GET /api/locations/:id`. A building can be chosen as the start or destination of the route planner. The browser's geolocation API can also provide a current position; the backend's nearest-location endpoint returns the three closest active buildings using PostGIS spatial distance.

### Verified route planning

Route planning requests `GET /api/routes?from=<id>&to=<id>`. The backend:

1. Validates both location identifiers and rejects identical endpoints.
2. Confirms that the source and destination are active.
3. Finds exact-direction active routes.
4. Reverses eligible bidirectional routes on response rather than storing duplicate geometry.
5. Removes unpublished, inactive, or endpoint-inactive routes.
6. Returns route geometry, distance, waypoints, accessibility metadata, GPS gaps, and route status.

A returned building-to-building route is a previously recorded and published pedestrian path. The endpoint planner does not invent a path when no published route matches; it can reverse a route only when that route is marked bidirectional.

### Building-level navigation today

The current navigation scope is **outdoor, building-to-building wayfinding**, not indoor navigation. Each active building is stored as a named location with a latitude/longitude, description, and optional image. Users can search or browse buildings, select a start and destination, or use GPS to identify the nearest registered building. The building coordinate marks the location on the campus map; it is not a surveyed entrance, floor, room, or indoor position.

For a selected start and destination, the application asks the backend for active, published routes with those exact endpoints. Route alternatives use administrator-recorded geometry, and a bidirectional route may be presented in reverse. For **Route from my current location**, the frontend instead builds a graph from published route points: points within 6 metres are joined, one-way routes keep their direction, and bidirectional routes add edges in both directions. The user's GPS position is projected onto a nearby graph edge (within 60 metres), then Dijkstra's shortest-path search finds a path from that point to the graph node nearest the destination building. If no recorded path is close enough or connected, the app reports that it cannot calculate the route rather than creating streets or paths.

The data-quality measures in place are:

- Administrators can set or adjust building coordinates on a map and record walking routes with the GPS route recorder.
- Route recordings filter inaccurate or implausible GPS fixes, preserve timestamps and accuracy, and mark interruptions; administrators can review route geometry and gaps before publishing.
- Publishing requires at least two recorded points, active endpoints, and acknowledgement when a route contains GPS gaps. Accessibility fields (stairs, ramp, covered) can be left unverified rather than treated as confirmed.
- Seeded building coordinates and route geometry are approximate; field-verify buildings and replace interpolated seed paths with on-site recordings before relying on them for real navigation.

There is currently no floor/room model, indoor positioning, turn-by-turn voice guidance, or guaranteed routing to a particular building entrance. Coverage is limited to the buildings and connected paths represented in the published campus data.

## Navigation implementation status

The implementation distinguishes four separate navigation states. This distinction is intentional and should be considered the current public behavior, not a planned feature list:

| Capability | Current implementation | Important limitation |
| --- | --- | --- |
| Search and building selection | Active buildings are loaded from the public API or the IndexedDB snapshot. The selected start and destination are explicit building records. | GPS is not used to overwrite the user's chosen start; a building suggestion is advisory only. |
| Building-to-building routes | `GET /api/routes?from=<id>&to=<id>` returns only active, published routes with exact endpoints. Bidirectional routes are reversed in the response. | The backend does not synthesize a path, and unconnected buildings can correctly return no alternatives. |
| Route from current GPS position | The frontend downloads published route data, builds a connected graph, snaps the GPS fix to an edge within 60 m, and runs Dijkstra to a graph node within 60 m of the destination. | It only follows currently published route geometry. It does not create missing segments or connect to roads outside that graph. |
| Live guidance on a selected route | Browser `watchPosition` feeds a filtered GPS fix into `PathTracker`, which projects onto the route and reports remaining distance, off-path state, and arrival. | It is follow-the-recorded-polyline guidance, not a turn-by-turn pedestrian routing engine. |
| Off-path recovery | After three accepted fixes beyond the accuracy-adjusted threshold (at least 30 m) from the active polyline, the app offers an alternative graph path or reports that none is available. | A switch requires the user's confirmation and is never automatic. |
| Building detection | Verified GeoJSON-style boundary polygons can produce an `inside` result; with the current seed data, detections are approximate reference-point suggestions. | The current database schema does not store building boundary polygons. Approximate detection must not be treated as confirmed entry or indoor position. |
| Indoor and entrance guidance | There is no implementation for rooms, floors, doors, or entrances. | The building coordinate is a reference point, not a surveyed entrance or an indoor location. |

The graph currently used for GPS-origin and recovery planning is constructed from `GET /api/offline/snapshot`. The snapshot contains all active locations and published routes. Until that snapshot is available, the **Route from my current location** action is disabled rather than estimated from an unverified map or road network.

### Current building detection

`frontend/src/lib/buildingDetection.js` keeps the raw GPS fix, reported accuracy, a building's stored reference coordinate, the user-selected start, and the destination separate. A current building is only claimed as “inside” when an explicitly supplied, verified boundary polygon contains the fix and accuracy is at most 30 m. General building suggestions are disabled above 40 m accuracy and for fixes older than 15 seconds. Approximate suggestions require the fix to remain within 80 m of a stored reference point.

The current database and seed data do not provide boundary polygons, so normal results are labelled **approximate** suggestions based on reference coordinates. Poor accuracy, stale fixes, equidistant/“between” cases, and outside-campus cases produce no building claim. A pair of nearby buildings remains ambiguous when the nearest candidate's lead over the next candidate is no greater than the larger of 12 m or the reported GPS accuracy. Hysteresis requires three consistent fixes before an approximate suggestion switches buildings. A suggestion never writes the navigation source: the user must explicitly choose a start building or choose “Route from my current location”.

### Live GPS navigation

Live navigation uses `navigator.geolocation.watchPosition` with high-accuracy mode. The frontend filter checks:

- Valid latitude and longitude
- Reported accuracy no worse than 30 metres
- Maximum implied speed of 12 m/s
- Movement from the previous accepted position
- Accuracy-weighted smoothing

Accepted fixes are map-matched against the selected recorded polyline. The tracker considers GPS accuracy, continuity with the previous matched segment, and distance to candidate segments rather than relying only on the geometrically nearest segment. Remaining distance is calculated by adding the rest of the matched segment and the complete distance of later usable segments. Marked GPS gaps are not filled by invented straight lines; the match also exposes a coarse confidence state.

The base off-path threshold is 30 metres, widened to 1.5 times reported accuracy when that is greater. Off-path detection requires three consecutive accepted fixes beyond this threshold. Arrival is checked on the final recorded segment and allows the 15-metre remaining-distance threshold to grow by up to 10 metres for GPS uncertainty; distance from the route must remain within twice the active match threshold.

The UI reports an off-path warning and may offer a different published graph path from the current GPS position to the chosen destination. The user must choose an alternative to switch; the application does not automatically change the selected route or continuously recalculate it. GPS gaps are not treated as walkable distance during live progress tracking.

### GPS reliability, confidence and map matching

The frontend uses a shared threshold policy in `frontend/src/lib/gpsThresholds.js`. Browser-reported accuracy is treated as an estimate, not a guaranteed error bound. Safety-related thresholds therefore use a conservative multiplier:

- building distinguishability: `max(12 m, accuracy × 2)`
- off-route corridor: `max(30 m, accuracy × 2)`
- arrival distance: `15 m + min(accuracy, 5 m)`

The GPS state machine reports `initializing`, `high`, `moderate`, `low`, `stale`, `unavailable`, `ambiguous`, `outside`, and `recovering`. A recovered GPS stream must produce several consecutive good fixes before returning to `high`.

Map matching considers distance to each segment, continuity with the previous matched segment, progress along the segment, GPS accuracy, and a dynamic corridor. Segment switches require a clear distance advantage, preventing small GPS fluctuations from moving the projection to an adjacent path.

### GPS route recording

Administrators record real walking paths with `navigator.geolocation.watchPosition`. The recorder:

- Rejects fixes with accuracy worse than 25 metres
- Ignores fixes less than 3 metres from the previous accepted point
- Rejects implied movement above 10 m/s
- Starts an independent segment after a 15-second or explicitly marked interruption
- Preserves accepted accuracy, timestamp, coordinates, and sequence number
- Stores unsaved geometry in `sessionStorage`
- Uploads batches to the backend every five seconds
- Uses sequence numbers and duplicate-safe database inserts for retries

Before publication, the route preview exposes its GPS gaps and waypoints. Publishing requires at least two points and an acknowledgement when the route contains GPS gaps.

### Administration

The admin console supports:

- Location CRUD and activation lifecycle
- Coordinate selection and nearby-location duplicate checks
- Image upload and server-side validation
- Route draft creation and GPS point batches
- Route metadata, waypoints, and publish/deactivate/reactivate/discard actions
- Location and route version history
- Version comparison and Super Admin restoration
- Admin account management
- Audit-log review

All mutating routes require authentication and role checks. Route and location updates use optimistic version locking.

### Admin building capture

When adding or editing a building, an administrator enters the name/details first and then taps **Capture My Current Location**. The shared capture helper waits for a fresh fix (never a cached position), rejects fixes worse than 30 m, prefers fixes at or below 20 m, and briefly samples around a preferred fix to report position spread. It shows latitude, longitude, accuracy, timestamp and quality. Retry and cancel are available while waiting. The captured coordinates populate the form and map preview, including an accuracy circle and capture-spread note; manual entry/map dragging remains an explicit fallback. Coordinates are validated again before save, while authentication, optimistic version checks, and audit history are unchanged.

### Offline support

The service worker provides application-shell caching and cache-first storage for viewed OpenStreetMap tiles. IndexedDB stores the current active-location and published-route snapshot.

When network requests fail, public location search, nearest-location lookup, and route alternatives can fall back to cached data. Administrative actions, authentication, uploads, and writes remain online-only.

Offline mode cannot manufacture routes or GPS directions. It can only use previously downloaded, server-published route geometry.

## Algorithms

### Haversine and campus-scale projections

For distance and navigation, coordinates are processed using Haversine distance and a local equirectangular projection:

```text
earth_radius = 6,371,000 metres
flat_projection.x = radians(delta_longitude) * cos(mean_latitude) * radius
flat_projection.y = radians(delta_latitude) * radius
```

The local projection is appropriate for a campus-sized area and avoids the repeated use of spherical calculations while projecting many GPS fixes onto recorded polyline segments.

### GPS point-to-segment projection

For each accepted fix, `PathTracker`:

1. Projects the fix onto every usable route segment.
2. Scores candidate segments using perpendicular distance and a small continuity preference for the previous match.
3. Prefers candidates inside the accuracy-adjusted search corridor when one is available.
4. Calculates the remaining distance from the selected projection, excluding all GPS-gap jumps.
5. Reports a coarse match confidence alongside distance, off-path, and arrival state.

The implementation therefore reports progress along the route rather than straight-line distance to the destination.

### Published-route graph and GPS-origin planning

For the "Route from my current location" action, `buildGraph` converts published route polylines into a graph. Route points no more than 6 metres apart are merged into a node; consecutive points form distance-weighted edges, and bidirectional routes also add reverse edges. The current UI projects the GPS fix onto the nearest edge only when it is within 60 metres, splits that edge at a temporary start node, then runs Dijkstra to the graph node nearest the destination building. This is constrained to the published path network. The graph module also provides a K-shortest-path helper, but the public building-to-building route list currently comes from the backend's published-route alternatives endpoint.

### GPS filtering and smoothing

The live tracker applies accuracy-weighted smoothing:

```text
old_weight = 1 / (old_accuracy^2)
new_weight = 1 / (new_accuracy^2)
blend = new_weight / (old_weight + new_weight)
smoothed = old + (new - old) * blend
```

It also rejects speed-implausible fixes. Live navigation uses a 12 m/s implied-speed limit; the stricter route recorder uses 10 m/s and a 25-metre accuracy threshold.

### Search ranking

Building search normalizes the search term and ranks matches in two stages:

1. Names beginning with the search term
2. Names containing the search term later

Tie-breakers use alphabetical name ordering. The PostgreSQL-side endpoint performs the database matching, while the frontend can also rank cached results while offline.

### Bidirectional route reversal

For exact endpoint matches, route points are returned in their stored order. For verified bidirectional reversed matches:

- Source and destination are exchanged
- Points are reversed
- Point sequence numbers are renumbered
- Waypoints are reversed and their end offsets are recalculated

The database route itself is not duplicated or mutated during a public lookup.

### Route ranking

Published alternatives are ranked deterministically before presentation. The backend's ranking preference is:

1. Routes without stairs
2. Routes with a ramp
3. Covered routes
4. Route identifier

The UI can additionally sort the same returned alternatives by recorded route distance. It never discovers or synthesizes a new route during sorting.

### Optimistic version locking

Locations and routes maintain integer version numbers. Mutations include `expectedVersion`. The backend:

1. Locks or re-reads the record.
2. Compares the current and expected versions.
3. Rejects stale changes with `409 VERSION_CONFLICT`.
4. Writes the change and increments the version atomically.

Snapshots of the previous and next states are retained for location and route history.

## Architecture

```text
Browser
  |
  | HTTPS
  v
Netlify / Vite React frontend
  |
  | REST API with HTTP-only cookies
  v
Render / Express backend
  |
  | PostgreSQL protocol
  v
Neon / PostgreSQL + PostGIS
```

Repository layout:

```text
frontend/
  src/pages/       Public and administrative screens
  src/components/  Map, search, route, and admin components
  src/lib/         Tracking, offline, geometry, and route helpers
  public/          PWA manifest, icons, and service worker

backend/
  src/routes/      Public, authentication, and admin endpoints
  src/services/    Business logic and database operations
  src/middleware/  Authentication and error handling
  db/schema.sql    Idempotent PostgreSQL/PostGIS migration
  scripts/         Migration and account seed scripts

docs/
  api-contracts.yaml
  demo-and-testing.md
```

## Data model

The PostgreSQL schema includes:

- `roles` and `users`
- `password_reset_tokens`
- `locations` and location geography
- `routes`, route points, and route waypoints
- `location_versions` and `route_versions`
- `audit_logs`

Relevant database guarantees include:

- Unique normalized user emails
- Active/inactive account states
- Foreign keys between routes, locations, and route points
- GiST spatial indexes for geography queries
- A PostgreSQL trigram index for location-name search
- Cascading cleanup for dependent route and reset records where defined
- Idempotent schema migration

Version snapshots are append-only history records. Restoration creates a new version instead of rewriting earlier snapshots.

## API security

The API uses:

- HTTP-only JWT session cookies
- `SameSite=None` and `Secure` cookies for production cross-origin hosting
- Role middleware for Admin and Super Admin endpoints
- Forced-password-change middleware for protected administrative actions
- Helmet security headers
- CORS origin allowlisting
- Per-IP login and password-reset rate limits
- Zod request validation
- PostgreSQL parameterized queries
- Server-side image signature and size validation

Public routes remain available for locations and navigation reads. Write routes require the appropriate administrator role.

## Technology stack

| Area | Technology |
| --- | --- |
| Frontend | React 18, Vite, TypeScript tooling, Leaflet |
| Backend | Node.js, Express |
| Database | PostgreSQL, Neon, PostGIS, `pg_trgm` |
| Authentication | JWT, HTTP-only cookies, bcryptjs |
| Validation | Zod |
| Security | Helmet, CORS, express-rate-limit |
| Offline | IndexedDB, service worker, cached map tiles |
| Hosting | Netlify and Render |

## Live deployment

| Component | URL |
| --- | --- |
| Backend health | https://campus-navigation-system-5bj3.onrender.com/api/health |
| Render API | https://campus-navigation-system-5bj3.onrender.com |
| Netlify site | https://campus-navigation-system-smvitm.netlify.app |

Set `VITE_API_URL` to the public Render API origin.

## Local development

### Prerequisites

- Node.js 18 or newer
- npm
- PostgreSQL 14 or newer with PostGIS
- Modern browser with geolocation support
- HTTPS or `localhost` for GPS and PWA features

### Install dependencies

From the repository root:

```bash
npm install
```

This installs both the `frontend` and `backend` npm workspaces.

### Start PostgreSQL

Docker Compose is supported:

```bash
docker compose up -d db
```

Default local database settings:

```text
Host: localhost
Port: 5432
Database: campus_nav
User: postgres
Password: postgres
```

### Configure the backend

```bash
cd backend
cp .env.example .env
```

Minimum local configuration:

```env
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_nav
DATABASE_SSL=false
JWT_SECRET=replace-with-a-random-string-at-least-32-characters
CORS_ORIGINS=http://localhost:5173
COOKIE_SECURE=false
STORAGE_DRIVER=local
PUBLIC_BASE_URL=http://localhost:4000
FRONTEND_URL=http://localhost:5173
```

### Migrate and seed

```bash
cd backend
npm run migrate
npm run seed:accounts
npm run seed:smvitm
npm run dev
```

The backend listens on `http://localhost:4000`.

### Start the frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Database setup

Apply the complete schema:

```bash
cd backend
npm run migrate
```

For hosted PostgreSQL:

```env
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>?sslmode=require
DATABASE_SSL=true
```

The migration creates PostGIS and trigram extensions and is safe to run repeatedly.

## Seed accounts

Never commit administrator passwords. Render generates a secret `SUPERADMIN_PASSWORD` and bootstraps `superadmin@smvitm.ac.in` only if that account does not already exist. Find the generated password in the Render service's Environment settings; the account must change it at first login. For other environments, set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` and run `npm run seed:superadmin` from `backend/`.

To reset an existing Super Admin, set `SUPERADMIN_EMAIL` and a new temporary `SUPERADMIN_PASSWORD` as Render environment secrets, then run `npm run reset:superadmin` from the Render Shell. This command updates only that Super Admin and forces a password change at next login. Remove the temporary password environment value after the command completes.

After signing in, use the Super Admin **Accounts** tab to create Admin or Super Admin accounts. Generated temporary passwords are shown once and must be changed at first login. Password reset by email requires `SMTP_URL` and `MAIL_FROM` to be configured on the backend.

The optional account seeder creates accounts only when they do not already exist. Set all credentials through the environment before running it:

```bash
npm run seed:accounts
```

Custom credentials can be supplied through:

```env
ADMIN_NAME=Campus Admin
ADMIN_EMAIL=admin@example.edu
ADMIN_PASSWORD=replace-with-a-secure-password
SUPERADMIN_NAME=Super Admin
SUPERADMIN_EMAIL=superadmin@example.edu
SUPERADMIN_PASSWORD=replace-with-a-secure-password
```

Seed scripts do not reset existing account passwords. Use the password-reset flow or the administrator account tools instead.

## Testing

### Frontend

```bash
cd frontend
npm test
npm run build
npx tsc --noEmit
```

### Backend

```bash
cd backend
npm test
```

Backend integration tests require a separate test database:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_nav_test
JWT_SECRET=a-very-long-test-secret-at-least-32-characters
```

Do not point integration tests at a production database. The suite creates and removes test records.

## Production deployment

### Backend: Render

Use [`render.yaml`](render.yaml) as the Render Blueprint.

Render settings:

```text
Root Directory: backend
Build Command: npm install --omit=dev
Pre-Deploy Command: npm run migrate
Start Command: npm start
Health Check: /api/health
```

Required Render variables:

```env
DATABASE_URL=<Neon PostgreSQL URL>
DATABASE_SSL=true
JWT_SECRET=<random secret of at least 32 characters>
COOKIE_SECURE=true
CORS_ORIGINS=https://campus-navigation-system-smvitm.netlify.app
PUBLIC_BASE_URL=<Render backend URL>
FRONTEND_URL=https://campus-navigation-system-smvitm.netlify.app
```

### Frontend: Netlify

The repository's `netlify.toml` provides the deployment configuration:

```text
Base Directory: frontend
Build Command: npm run build
Publish Directory: dist
```

In production the frontend uses the same-origin `/api` proxy defined in `netlify.toml`; no `VITE_API_URL` or `frontend/.env.production` is required.

## Security

- Use HTTPS for browser geolocation and secure cookies.
- Keep database credentials and JWT secrets only in deployment environment variables.
- Never commit `.env` files or credentials.
- Rotate any credential that has been exposed in chat or source control.
- Set `COOKIE_SECURE=true` and a restricted `CORS_ORIGINS` value in production.
- Replace the local filesystem image driver with durable object storage before production use.
- Change all seeded passwords before public deployment.
- Restrict Super Admin account creation and restore operations.
- Review audit logs and database backups regularly.

## Limitations

- **Scope:** The implemented system is outdoor, building-to-building wayfinding over published walking polylines. It has no indoor floors, rooms, doors, or building-entrance routing.
- **Route discovery:** Building-to-building alternatives require exact endpoints and active/published route records. The backend cannot generate or infer a route for endpoint pairs that have no eligible recording.
- **GPS-origin routing:** A GPS position must be within 60 metres of a graph edge and the destination must be within 60 metres of a graph node. Missing, disconnected, or unrecorded campus paths are not invented.
- **Off-path behavior:** Three sustained readings beyond the accuracy-adjusted threshold (30 metres minimum) trigger a recovery offer. The app does not automatically switch routes; the user must confirm a suggested alternate.
- **GPS dependence:** Accuracy, arrival, and off-path decisions depend on browser permissions, device hardware, satellite conditions, surroundings, and operating-system behavior.
- **Building detection:** Approximate suggestions are based on stored reference coordinates and are not a claim that the user is inside a building. Verified boundary detection requires boundary data that the current database does not contain.
- **Seed quality:** Seeded building coordinates and routes are approximate. They require field verification and replacement with real recordings before use for real-world navigation.
- **GPS gaps:** Time or explicit interruptions split route segments. The UI does not join across a gap or count the gap as walkable distance.
- **Offline:** Cached public locations/routes and viewed map tiles can remain usable, but authentication, administration, uploads, route publishing, and all writes require network access.
- **Accessibility metadata:** `NULL` means “not verified,” not “stairs absent,” “ramp absent,” or “not covered.”
- **Storage:** Uploaded images use local server storage. Durable object storage is still required for a resilient production deployment.

## Documentation

- [`RUNNING.md`](RUNNING.md) - detailed local setup and troubleshooting
- [`DEPLOYMENT.md`](DEPLOYMENT.md) - deployment operations
- [`docs/api-contracts.yaml`](docs/api-contracts.yaml) - OpenAPI contract
- [`docs/demo-and-testing.md`](docs/demo-and-testing.md) - testing and demonstration guide
- [`research_implementation_mapping.md`](research_implementation_mapping.md) - requirements-to-implementation mapping

## Project team

- Shravya
- Shreekala
- Vidhusha S Naik
- Yuktha S Mayya

## License

This repository is private and is intended for the SMVITM campus navigation project. A public redistribution license is not currently defined.

## Recent capabilities (latest)

- **Verified GPS and building separation:** the public app keeps raw and filtered GPS fixes separate from route projections and building sources; approximate suggestions never silently become a navigation start.
- **Fresh, stability-aware GPS capture:** shared geolocation capture waits for a current, accurate fix, prefers fixes at or below 20 m (30 m maximum), samples briefly to report position spread, and supports cancellation/retry.
- **Accuracy-aware building and route matching:** uncertain GPS makes close building candidates remain ambiguous; live route matching uses accuracy and segment continuity to reduce noisy snapping and provides match-confidence feedback.
- **Graph-based GPS-origin planning** (`frontend/src/lib/routeGraph.js`): converts published routes into a connected graph, supports bidirectional edges, Dijkstra shortest paths, a K-shortest-path helper, and point-to-segment projection for intermediate starting positions. The current public UI uses the graph for routes from the user's current position; building-to-building alternatives still come from the published-route endpoint.
- **Confirmation-only off-path recovery:** after three sustained off-path readings, the app compares a graph result from the current projected position with the active polyline and offers a different published path only when one exists. The destination remains unchanged and the user confirms the switch.
- **Stop and retry controls:** live navigation can be stopped explicitly, and GPS capture/navigation can recover from weak fixes or retries without changing the selected route automatically.
- **Satellite map:** Map/Satellite toggle using free Esri World Imagery (no API key, proper attribution).
- **GPS-first building capture:** admins wait for an acceptable fresh fix, review coordinates/accuracy/timestamp, retry if needed, and may fall back to explicit manual/map entry.
- **Landmark marking during recording:** admins can create new landmarks at their current GPS position while recording a route.
- **Route editing:** admins can edit route metadata (name, directionality, stairs/ramp/covered, notes) after recording.
- **PWA/offline:** service worker caches shell + assets + viewed tiles; IndexedDB caches locations/routes; offline banner and fallback.
- **Same-origin API proxy:** Netlify/Vercel proxy `/api` and `/uploads` to Render for reliable cookie auth.
- **CI:** GitHub Actions runs with a PostGIS service container; backend tests are hermetic on an isolated database.
