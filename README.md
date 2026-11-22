# SMVITM Campus Navigation System

A full-stack pedestrian navigation application for **Shri Madhwa Vadiraja Institute of Technology and Management (SMVITM), Bantakal, Udupi, Karnataka, India**.

The application combines a public Leaflet map, recorded GPS walking routes, live route tracking, offline read-only support, and an authenticated administration console for maintaining campus locations and route data.

> **Important:** Route geometry in the seed script is interpolated demonstration data. For production navigation, replace it with GPS tracks recorded on campus using the administration recorder.

## Features

### Public navigation

- Interactive Leaflet map using OpenStreetMap tiles
- Active campus-building markers with selectable location details
- Case-insensitive building search with prefix-first ranking
- Optional browser voice search where Web Speech Recognition is supported
- Category filtering for campus locations
- Start and destination selection
- “Use my location” start selection using the nearest active building
- Multiple verified route alternatives
- One-way and bidirectional route support
- Reverse matching for eligible bidirectional routes, including reversed points and waypoints
- Route metadata:
  - Approximate recorded distance
  - Walking-time estimate
  - Stairs, ramp, and covered-path information
  - Intermediate waypoints
  - GPS-gap warnings
- Live GPS navigation with:
  - Current-position marker and accuracy circle
  - Follow-me map mode
  - Wake Lock while navigating, where supported
  - Remaining distance
  - Next waypoint display
  - Off-path warning
  - Arrival detection
  - Permission, timeout, weak-signal, and unsupported-browser messages
- Explicit route selection: the application does **not** automatically switch routes or reroute.
- Public location and route reads can fall back to the device cache when the network is unavailable.

### GPS route recording

Administrators can record real walking routes at `/admin/record`.

- Uses browser `navigator.geolocation.watchPosition`
- Never generates synthetic GPS points
- Accepts fixes only when accuracy is at most 25 metres
- Ignores fixes closer than 3 metres to the previous accepted point
- Rejects physically implausible movement above 10 m/s
- Records accuracy, timestamp, latitude, longitude, and sequence number
- Marks interruptions and long pauses as GPS gaps instead of drawing unsupported straight lines
- Persists the active recording session in `sessionStorage`
- Restores after reload in a paused state; recording never resumes silently
- Uploads points in batches every five seconds
- Uses sequence numbers and duplicate-safe inserts for retryable uploads
- Supports waypoint selection and ordering
- Provides map preview before saving or publishing
- Saves a server-side draft, publishes it, or discards it
- Requires acknowledgement before publishing a route containing GPS gaps

### Administration

- Cookie-based JWT authentication
- Admin and Super Admin roles
- Forced password-change flow
- Login, logout, current-user, change-password, forgot-password, and reset-password flows
- Location management:
  - Create, edit, activate, deactivate
  - Coordinate picker
  - Nearby-location duplicate detection
  - Image upload
- Route management:
  - Create drafts
  - Append GPS point batches
  - Edit metadata and geometry
  - Publish, deactivate, reactivate, or discard drafts
- Location and route version history
- Version comparison
- Super Admin restore of historical versions
- Super Admin user management
- Super Admin audit-log viewing
- Optimistic version locking to prevent stale updates

### Offline and PWA support

- Web app manifest and production service worker
- IndexedDB cache containing active locations and published route geometry
- Atomic cache synchronization from `/api/offline/snapshot`
- Cache updates use `versionNumber` values and remove deactivated records
- Offline search, nearest-building lookup, and cached route alternatives
- Cache-first storage for OpenStreetMap tiles the user has already viewed
- Maximum of 400 cached map tiles
- Network-first navigation fallback with an offline page
- Administration and all write operations remain online-only

## Technology stack

| Area | Technologies |
| --- | --- |
| Frontend | React 18, React Router, Vite, TypeScript entry/tooling, Leaflet |
| Backend | Node.js 18+, Express, CommonJS |
| Database | PostgreSQL 14+ with PostGIS and `pg_trgm` |
| Authentication | JWT, HTTP-only cookies, bcryptjs |
| Validation | Zod |
| Security middleware | Helmet, CORS, express-rate-limit |
| Offline storage | IndexedDB and a service worker |
| Maps | Leaflet with OpenStreetMap tiles |

## Architecture

```text
frontend/
  src/
    pages/              Public navigation, admin login, dashboard, recorder
    components/         Map, search, route facts, admin panels, shared UI
    hooks/              GPS recorder and wake-lock hooks
    lib/                Geospatial, tracking, route-selection, offline helpers
  public/               PWA manifest, icons, service worker

backend/
  src/
    routes/             Public, authentication, and admin HTTP routes
    services/           Locations, routes, users, audit, mail, storage
    middleware/         Authentication and error handling
    utils/              Validation, geometry, image, and async helpers
  db/schema.sql         Idempotent PostgreSQL/PostGIS schema
  scripts/              Migration and seed scripts

docs/
  api-contracts.yaml    OpenAPI 3 endpoint contract
```

The frontend communicates with the Express API through `frontend/src/api.js`. Public read requests use the API first and fall back to IndexedDB only for network failures. Admin requests always require an online API connection.

## Algorithms and implementation details

### Distance and geometry

- **Haversine distance:** Calculates distances between latitude/longitude coordinates in metres.
- **Local flat projection:** Projects nearby coordinates into a local metre-based plane. This is accurate for campus-sized paths and makes point-to-segment calculations practical.
- **Point-to-polyline projection:** Finds the closest route segment to the current GPS position and calculates the remaining walkable distance from the projected position to the route end.
- **Walkable segment length:** Sums each recorded segment independently. Distances across marked GPS gaps are deliberately excluded.
- **PostGIS distance calculations:** The backend uses `ST_Length` for route distance and geography KNN ordering for nearest active locations.

### GPS filtering and tracking

The `GpsFilter`:

1. Rejects invalid coordinates.
2. Rejects fixes whose reported accuracy exceeds the configured limit.
3. Rejects jumps whose implied speed exceeds the configured limit.
4. Smooths accepted fixes using accuracy-weighted averaging.

`PathTracker` then:

1. Locates the filtered position on every usable route segment.
2. Chooses the closest segment.
3. Computes remaining distance using only walkable segment lengths.
4. Counts consecutive fixes more than 30 metres from the path.
5. Reports off-path status after three consecutive out-of-path fixes.
6. Reports arrival on the final segment when remaining distance is at most 15 metres and the position is within the arrival boundary.

Navigation thresholds are intentionally conservative and should be validated with real devices on campus.

### Route matching and ranking

The backend returns active routes whose endpoints are active. It matches:

- Exact source-to-destination routes
- Reversed destination-to-source routes only when `directionality = 'bidirectional'`

Reversed routes are returned without modifying the database. Their endpoints, points, and waypoints are reversed and sequence numbers are renumbered. Alternatives are sorted deterministically by:

1. Routes with `hasStairs = false`
2. Routes with `hasRamp = true`
3. Routes with `isCovered = true`
4. Route ID

`NULL` accessibility values mean **not verified** and are not treated as false.

### Search and spatial checks

- Building search is case-insensitive partial matching with prefix matches ranked first.
- PostGIS KNN queries return the nearest active buildings to a GPS coordinate.
- Location creation and coordinate changes check for active locations within the configured duplicate radius, 15 metres by default.
- Database indexes include GiST spatial indexes and a trigram index for location names.

### Versioning and consistency

Locations and routes have independent integer version numbers. Mutating requests provide `expectedVersion`; the backend locks the row and returns `409 VERSION_CONFLICT` when the version is stale.

Every versioned change stores:

- A complete JSON snapshot
- Version number
- Modifier
- Timestamp
- Human-readable change description

Restoring a version creates a new version; history is never rewritten. Audit records store the previous and next snapshots for administrative actions.

## API

The API base path is `/api`. Successful responses use resource-specific JSON shapes. Errors consistently use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": []
  }
}
```

### Health and public endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Database-backed health check |
| GET | `/locations` | List active locations |
| GET | `/locations/search?q=&limit=` | Search active locations |
| GET | `/locations/:id` | Get one active location |
| GET | `/locations/nearest?lat=&lng=&limit=` | Find nearest active locations |
| GET | `/routes?from=&to=` | Return verified route alternatives |
| GET | `/offline/snapshot` | Download active locations and published route geometry |

### Authentication endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Authenticate and issue an HTTP-only cookie |
| POST | `/auth/logout` | Clear the session cookie |
| GET | `/auth/me` | Return the current authenticated user |
| POST | `/auth/change-password` | Change the current password |
| POST | `/auth/forgot-password` | Request a password-reset message |
| POST | `/auth/reset-password` | Reset a password using a token |

### Admin location endpoints

All endpoints below are under `/admin` and require Admin or Super Admin access unless noted.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/locations` | List active/inactive locations with filters |
| GET | `/locations/:id` | Get a location, including inactive records |
| GET | `/locations/nearby?lat=&lng=` | Check nearby active locations |
| POST | `/locations` | Create a location |
| PUT | `/locations/:id` | Update a location with `expectedVersion` |
| POST | `/locations/:id/deactivate` | Deactivate a location |
| POST | `/locations/:id/reactivate` | Reactivate a location |
| POST | `/uploads/image` | Upload a validated JPEG, PNG, or WebP image |
| GET | `/locations/:id/versions` | List location versions |
| GET | `/locations/:id/versions/:n` | Read a location snapshot |
| GET | `/locations/:id/versions/compare` | Compare two location versions |
| POST | `/locations/:id/restore` | Restore a version; Super Admin only |

### Admin route endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/routes` | List routes with status and endpoint filters |
| GET | `/routes/:id` | Read a route and its geometry |
| POST | `/routes` | Create a draft route |
| POST | `/routes/:id/points` | Append a GPS point batch |
| PUT | `/routes/:id` | Update route metadata, waypoints, or geometry |
| POST | `/routes/:id/publish` | Publish a valid draft |
| POST | `/routes/:id/deactivate` | Deactivate an active route |
| POST | `/routes/:id/reactivate` | Reactivate an inactive route |
| DELETE | `/routes/:id` | Discard a draft route |
| GET | `/routes/:id/versions` | List route versions |
| GET | `/routes/:id/versions/:n` | Read a route snapshot |
| GET | `/routes/:id/versions/compare` | Compare two route versions |
| POST | `/routes/:id/restore` | Restore a version; Super Admin only |

### Super Admin endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/audit-logs` | View filtered audit records |
| GET | `/users` | List administrator accounts |
| POST | `/users` | Create an administrator |
| PATCH | `/users/:id` | Update account role or status |

The complete OpenAPI 3 contract is available in [`docs/api-contracts.yaml`](docs/api-contracts.yaml).

## Local development

### Prerequisites

- Node.js 18 or newer
- npm
- PostgreSQL 14 or newer with PostGIS
- A modern browser
- HTTPS or `localhost` for browser geolocation and service-worker features

### 1. Start PostGIS

Docker is recommended:

```bash
docker compose up -d db
```

The supplied container uses:

```text
host: localhost
port: 5432
database: campus_nav
user: postgres
password: postgres
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

At minimum, configure:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_nav
JWT_SECRET=replace-with-at-least-32-characters
```

Useful optional variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | Express server port |
| `DATABASE_SSL` | `false` | Enable PostgreSQL TLS |
| `JWT_EXPIRES_IN` | `8h` | JWT lifetime |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed frontend origins |
| `COOKIE_SECURE` | Based on environment | Use secure cookies in production |
| `STORAGE_DRIVER` | `local` | Current supported image driver |
| `UPLOAD_DIR` | `uploads` | Local image directory |
| `PUBLIC_BASE_URL` | `http://localhost:4000` | Public API origin used in image URLs |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend URL used by password-reset mail |
| `MAX_IMAGE_MB` | `3` | Maximum server-side image size |
| `DUPLICATE_RADIUS_M` | `15` | Location duplicate-check radius |
| `SMTP_URL` | empty | SMTP connection string for reset mail |
| `MAIL_FROM` | local default | Password-reset sender address |

### 3. Install, migrate, and seed

```bash
cd backend
npm install
npm run migrate
npm run seed:smvitm
npm run dev
```

The SMVITM seed is idempotent and creates:

- Six active campus buildings
- Three demonstration pedestrian routes
- A Super Admin account if one does not already exist

When created by the seed, the initial account is:

```text
Email:    admin@smvitm.ac.in
Password: SMVITMAdmin@2024
```

Change seeded credentials before using the application outside local development.

### 4. Start the frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

The frontend reads `VITE_API_URL` when supplied. If it is empty, it targets the same origin and appends `/api`.

## Testing and verification

### Frontend

```bash
cd frontend
npx tsc --noEmit
npm test
npm run build
```

Frontend tests cover geospatial helpers, GPS filtering and smoothing, route tracking, off-path and arrival behavior, and offline route alternatives.

### Backend

```bash
cd backend
npm test
```

Backend unit tests cover route reversal and sorting, snapshot differences, coordinate validation, and image signature validation. Integration tests require an isolated PostGIS database:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_nav_test \
JWT_SECRET=a-very-long-secret-key-at-least-32-chars \
npm test
```

Use a separate test database because integration tests create and clean up records.

### Manual GPS demonstration

1. Run the frontend on `localhost` or HTTPS.
2. Open Chrome DevTools → More tools → Sensors.
3. Simulate coordinates near the seeded campus buildings.
4. Test nearest-building selection and live navigation.
5. Move more than 30 metres from the selected route for three accepted fixes to display the off-path warning.
6. Move within 15 metres of the final route point to test arrival.
7. Test permission denial, poor accuracy, timeouts, and browser backgrounding.

## Deployment

### Frontend

The repository includes configuration for Netlify and Vercel:

- [`netlify.toml`](netlify.toml)
- [`vercel.json`](vercel.json)

Set `VITE_API_URL` to the public Express API origin, with or without the `/api` suffix.

### Backend

[`render.yaml`](render.yaml) describes a Node service that:

1. Installs backend dependencies.
2. Runs the idempotent migration.
3. Starts the Express server.
4. Exposes `/api/health` as its health check.

Production requires:

- Managed PostgreSQL with PostGIS
- HTTPS
- Strong `JWT_SECRET`
- Correct `CORS_ORIGINS`
- `COOKIE_SECURE=true`
- A persistent image-storage implementation

The current `local` storage driver writes files to the server filesystem. Many hosted free tiers use ephemeral disks, so use durable object storage such as S3, Cloudinary, or Supabase Storage before relying on uploaded images in production. The application stores only the resulting image URL in PostgreSQL.

## Data model

The PostGIS schema contains:

- `users`, `roles`, and `password_reset_tokens`
- `locations` with generated geography points and active-name uniqueness
- `routes` with endpoint, directionality, accessibility metadata, and lifecycle status
- `route_points` with ordered GPS geometry
- `route_waypoints` linking routes to campus locations
- `location_versions` and `route_versions`
- `audit_logs`

The migration in [`backend/db/schema.sql`](backend/db/schema.sql) is idempotent and creates the required PostGIS and trigram extensions.

## Known limitations

- Route lines are recorded pedestrian evidence, not turn-by-turn road-network directions.
- There is no automatic rerouting or automatic route switching.
- Off-path detection displays a warning only.
- Offline mode supports cached public reads; administration and writes require connectivity.
- Only map tiles already viewed are cached; the app does not bulk-download OpenStreetMap tiles.
- The browser and operating system control GPS quality, permission, background execution, and voice recognition availability.
- Seed coordinates and interpolated paths are approximate and must be field-verified.
- Accessibility metadata can be `NULL`, meaning it has not been verified.
- The current image driver is local filesystem storage.
- Real-device testing on the SMVITM campus is required before production use.

## Related documentation

- [`RUNNING.md`](RUNNING.md) — expanded local setup, GPS, offline, and deployment notes
- [`docs/demo-and-testing.md`](docs/demo-and-testing.md) — API and demonstration checklist
- [`docs/api-contracts.yaml`](docs/api-contracts.yaml) — OpenAPI 3 contract
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — deployment-specific guidance
- [`research_implementation_mapping.md`](research_implementation_mapping.md) — mapping of research goals to implemented features
