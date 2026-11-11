# Campus Navigation System — Backend + basic frontend

Express + PostgreSQL/PostGIS backend and a minimal React/Leaflet shell, following
*Campus_Navigation_System_Final_Implementation_Reference_v5*.

## Run locally
Prerequisites: Node 18+, PostgreSQL 14+ with PostGIS (local, or free Neon/Supabase — both include PostGIS).

```bash
# 1. Database (local example)
createdb campus_nav            # or create a DB on Neon/Supabase and copy its URL

# 2. Backend
cd backend
cp .env.example .env           # set DATABASE_URL, JWT_SECRET (32+ chars), SUPERADMIN_* values
npm install
npm run migrate                # applies db/schema.sql (PostGIS, tables, indexes)
npm run seed:superadmin        # first Super Admin (forced password change at first login)
npm test                       # unit tests (route reversal/sorting/diff/image sniffing)
npm run dev                    # http://localhost:4000/api/health

# 3. Frontend (new terminal)
cd frontend && npm install && npm run dev      # http://localhost:5173
npm test                                       # GPS filter / off-path / offline-route unit tests
# Offline PWA is active only in a production build:  npm run build && npm run preview  (service workers need HTTPS or localhost)
```

On Windows, create the backend environment file before starting the server:

```powershell
Copy-Item backend/.env.example backend/.env
# Edit backend/.env and replace DATABASE_URL with your PostgreSQL username,
# password, host, port and database name. Set JWT_SECRET to 32+ characters.
npm run migrate --workspace backend
npm run seed:superadmin --workspace backend
npm run dev:backend
```

The database user in `.env.example` is only an example. If PostgreSQL reports
`password authentication failed`, use the password configured for your local
`postgres` role. Login will not work until the migration and Super Admin seed
commands complete successfully.

## Deploy the frontend

The repository includes `netlify.toml` and `vercel.json`, so either platform can
install dependencies and build the Vite app without adding scripts in the hosting
dashboard. Set the frontend environment variable `VITE_API_URL` to the public
origin of the deployed Express API, for example `https://api.example.com` (or
`https://api.example.com/api`). Set the backend `CORS_ORIGINS` to the deployed
frontend URL and keep `COOKIE_SECURE=true` in production.

The backend still needs a Node host with PostgreSQL/PostGIS and persistent image
storage. Netlify and Vercel serve the frontend build; they do not provide the
database or durable local filesystem used by the development storage driver.

## API summary (all under /api)
Public (no login)
- GET `/locations/nearest?lat&lng` (PostGIS nearest buildings) · GET `/offline/snapshot` (data for the offline cache)
- GET `/locations` · GET `/locations/search?q=` · GET `/locations/:id` (active only)
- GET `/routes?from=<id>&to=<id>` — exact match + verified bidirectional reverse (reversed points/waypoints, `reversed:true`); active routes with active endpoints only; sorted stairs=false → ramp → covered → id; `null` = not verified

Auth: POST `/auth/login`, `/auth/logout`, GET `/auth/me`, POST `/auth/change-password`, `/auth/forgot-password`, `/auth/reset-password`

Admin + Super Admin (`/admin`)
- Locations: GET/POST `/locations`, GET `/locations/nearby?lat&lng` (PostGIS duplicate check), GET/PUT `/locations/:id`, POST `/locations/:id/deactivate|reactivate`, POST `/uploads/image`
- Routes: GET/POST `/routes` (creates a **draft**), POST `/routes/:id/points` (live GPS batches), PUT `/routes/:id`, POST `/routes/:id/publish|deactivate|reactivate`, DELETE `/routes/:id` (drafts only)
- History: GET `/locations|routes/:id/versions` (paginated), `/versions/:n`, `/versions/compare?from&to`
- Updates/status changes require `expectedVersion`; stale → **409 VERSION_CONFLICT** with current data.

Super Admin only: POST `/locations|routes/:id/restore` `{versionNumber, expectedVersion}`, GET `/audit-logs`, GET/POST `/users`, PATCH `/users/:id`

Errors always look like `{ "error": { "code", "message", "details?" } }`.

## Notes
- Image storage: `local` driver is for development only. Add a persistent driver in `src/services/storage.js` (Supabase Storage / Cloudinary) before the hosted demo — only the https URL is stored in PostgreSQL.
- Not included (per scope): GPS smoothing, distance, off-path/arrival, auto start detection, rerouting, offline PWA, OpenAPI file (`docs/api-contracts.yaml` is still a Stage 1 task).
- Frontend is only the backend-owner shell (map, start/destination dropdowns, alternatives, live position, login). Search/voice, location details, history UI and the admin dashboard are teammates' components.

## Added in this revision
- **Stale responses:** `reqSeq` is bumped on every start/destination change (and every search/reroute), so a late response can never overwrite a newer selection.
- **Publishing** now verifies the endpoints *and every waypoint* are still active (waypoint status still never hides an already-published route, per section 8.2).
- **Route recording UI:** `/admin/record` — pick endpoints, walk, points are filtered (accuracy ≤ 25 m, ≥ 3 m spacing) and uploaded in batches every 5 s with sequence numbers (safe retries, kept on device if upload fails), mark waypoints, preview, save draft / publish / discard.
- **Navigation:** GPS filtering + smoothing, distance (PostGIS length per route, remaining metres live), off-path detection (3 consecutive fixes > 30 m), arrival detection (≤ 15 m).
- **Rerouting:** only along verified recorded paths — another alternative passing your position, else the nearest building becomes the new start and its recorded routes to the destination are offered.
- **Offline PWA:** manifest, service worker (app shell + only the map tiles you viewed), IndexedDB cache of locations and routes (refreshed on load / when back online, using `versionNumber`). Admin and all writes stay online-only.
- **docs/api-contracts.yaml:** OpenAPI 3 contract for every endpoint (open in https://editor.swagger.io). Freeze it with `git tag api-v1.0` once the team has reviewed it.
