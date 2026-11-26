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

The system does not infer roads or construct a shortest campus route graph. It treats approved route recordings as the source of truth and provides matching, filtering, GPS projection, distance calculation, and offline access around those routes.

## Table of contents

- [Feature overview](#feature-overview)
- [How features work](#how-features-work)
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
| Navigation | Track the device against a selected recorded polyline and receive off-path or arrival feedback | Preview gaps and route metadata before publishing |
| Accessibility | View stairs, ramp, covered-path, and waypoint information | Set and verify accessibility metadata |
| Offline use | Search cached buildings and browse cached route alternatives | Not available for writes or administration |
| Data governance | Read only the current active public state | Manage versions, restore snapshots, and review audit logs |
| Accounts | Log in, change passwords, and request password resets | Manage Admin/Super Admin users and account status |

### Public users

- Interactive Leaflet campus map
- Building search and category filtering
- Nearest-building detection from browser GPS
- Multiple published route alternatives
- Step, ramp, covered-path, and waypoint metadata
- Live position tracking and off-path alerts
- Recorded-polyline navigation with arrival detection
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

A returned route is evidence of a previously recorded pedestrian path. It is not generated by a road-network or campus graph.

### Live GPS navigation

Live navigation uses `navigator.geolocation.watchPosition` with high-accuracy mode. The frontend filter checks:

- Valid latitude and longitude
- Usable reported accuracy
- Maximum implied speed
- Movement from the previous accepted position
- Accuracy-weighted smoothing

Accepted fixes are projected onto the closest segment of the selected recorded polyline. Remaining distance is calculated by adding the rest of the selected segment and the complete distance of later usable segments. Marked GPS gaps are not filled by invented straight lines.

Off-path detection requires three consecutive accepted fixes more than 30 metres from the selected segment. Arrival requires:

- The projected position to be on the final segment
- Remaining distance no greater than 15 metres
- Position no more than twice the off-path threshold from the route

The UI intentionally reports an off-path warning instead of silently changing routes or calculating an alternative.

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
2. Calculates the perpendicular projection coefficient and clamps it to the segment.
3. Converts the nearest projected point back to the relevant segment position.
4. Selects the segment with the smallest perpendicular distance.
5. Calculates the remaining distance by summing the remainder of the chosen segment and later segment lengths.

The implementation therefore reports progress along the route rather than straight-line distance to the destination.

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

`VITE_API_URL` is set to the Render API origin in [`frontend/.env.production`](frontend/.env.production).

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

- Navigation follows published recorded polylines; it is not road-network routing and does not calculate or automatically switch to a new route.
- GPS accuracy depends on the device, surroundings, and operating-system permissions.
- Seeded route geometry is approximate and must be field-verified before real-world use.
- GPS gaps are left unjoined because the application does not infer missing movement.
- Offline mode provides cached public reads only; administration and writes require connectivity.
- Accessibility fields marked `NULL` mean "not verified," not "feature absent."
- Uploaded images use local server storage and require object storage for durable production hosting.

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
