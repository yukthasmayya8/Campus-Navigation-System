# How to Run SMVITM Campus Navigation System

## Quick start (local development)

### 1) Prerequisites
- **Node.js 18+** and npm
- **PostgreSQL 14+ with PostGIS** (required for migrations, spatial queries, and integration tests)
  - Option A: **Docker** (recommended for reproducible setup)
  - Option B: Local PostgreSQL installation/service
  - Option C: Managed PostgreSQL with PostGIS (Neon/Supabase/Render/etc.)
- Modern browser (Chrome/Edge recommended). For geolocation/PWA features, use **HTTPS** or `localhost`.

### 2) Start PostgreSQL/PostGIS

#### Option A: Docker (easiest)
From repo root:
```bash
docker compose up -d db
```
This starts PostGIS on `localhost:5432` with:
- user: `postgres`
- password: `postgres`
- database: `campus_nav`

`backend/.env` in this repo is preconfigured for this local setup.

#### Option B: Existing local PostgreSQL (Windows service detected on this machine)
If you already have PostgreSQL running (e.g. `postgresql-x64-18` service), create a database and user/password you can access, then update `backend/.env`:
```env
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/campus_nav
DATABASE_SSL=false
```
Create DB (example with psql):
```bash
psql -U postgres -h localhost -c "CREATE DATABASE campus_nav;"
```
> If you get `password authentication failed`, use the correct password for your local PostgreSQL user or configure `pg_hba.conf` appropriately.

#### Option C: Managed Postgres (Neon/Supabase)
Create a PostGIS-enabled database and set `DATABASE_URL` (and usually `DATABASE_SSL=true`).

### 3) Backend setup
```bash
cd backend
npm install
# ensure backend/.env is configured (JWT_SECRET >= 32 chars, DATABASE_URL, etc.)
npm run migrate
npm run seed:smvitm        # idempotent: 6 SMVITM buildings + 3 routes
# optional: npm run seed:superadmin
npm run dev                # http://localhost:4000
```
Health check: `GET http://localhost:4000/api/health` → `{ "status": "ok" }`

### 4) Frontend setup
```bash
cd frontend
npm install
npm run dev                # http://localhost:5173
```
Open `http://localhost:5173`.

### 5) Login (seeded admin)
If `seed:smvitm` created the super admin:
- Email: `admin@smvitm.ac.in`
- Password: `SMVITMAdmin@2024`

(If using `seed:superadmin`, credentials come from `backend/.env` and forced password change may apply.)

## Running tests and builds

### Frontend
```bash
cd frontend
npx tsc --noEmit
npm test
npm run build
```

### Backend (unit tests)
```bash
cd backend
npm test
```

### Backend integration tests (requires isolated PostGIS DB)
Integration tests in `backend/test/integration.test.js` need `TEST_DATABASE_URL` and apply schema to that DB. Example:
```bash
# create isolated test database first (example)
# createdb campus_nav_test  (or via psql/docker)

# PowerShell
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/campus_nav_test"
$env:JWT_SECRET="a-very-long-secret-key-at-least-32-chars"
cd backend
npm test
```
> Use a separate test database; integration tests perform setup/cleanup operations.

## GPS and navigation testing (without field hardware)
Real on-campus GPS validation requires physical device testing, but you can demo/test logic with browser tools:

1. **Chrome DevTools Sensors**
   - Open DevTools → More tools → **Sensors**
   - Override location (lat/lng) and simulate movement by changing coordinates over time
   - Test: nearest-building detection, live tracking, off-route (>30 m for 3 fixes), reroute suggestions, arrival (~15 m)
2. **Accuracy simulation**
   - Use device mode/mobile emulation; low accuracy/denied permissions can be tested by blocking location permission in site settings
3. **HTTPS requirement**
   - Geolocation works on `localhost`; for real mobile devices over network, serve frontend/backend via HTTPS
4. **Wake lock**
   - Test on supported mobile browsers during active navigation
5. **Route recording**
   - Use `/admin/record` with simulated or real GPS to generate recorded route geometry; seeded routes are interpolated approximations and should be replaced/refined with recordings

## Offline/PWA demo
1. Run a production build/preview (service worker registers in production):
   ```bash
   cd frontend
   npm run build
   npm run preview
   ```
2. Load the app online once and wait for data sync ("Offline data saved" timestamp)
3. Turn network offline in DevTools and verify cached locations/routes/search/nearest fallback behavior
4. Reconnect to sync
> Server-side rerouting while fully offline is not supported; cached client data/routes are used when available.

## Deployment blockers and how to address them

### 1) PostgreSQL/PostGIS database
- **Solved for local dev:** use `docker compose up -d db` or local/managed PostGIS and configure `backend/.env`
- **Production:** provision managed Postgres with PostGIS (Neon/Supabase/Render/Railway/etc.), set `DATABASE_URL`/`DATABASE_SSL`, run migrations/seeds, enable backups (`pg_dump`)

### 2) Real device/field GPS testing
- **Cannot be fully completed without physical testing.** Validate on Android/iOS devices over HTTPS at SMVITM campus, refine building coordinates/routes using Admin Recorder, and verify thresholds (30 m accuracy filter target, 30 m off-route after 3 fixes, 15 m arrival) under real conditions.

### 3) External deployment credentials/infrastructure (HTTPS, managed DB, persistent storage)
- **Frontend hosting:** Netlify/Vercel/static host with `VITE_API_URL` set (configs included)
- **Backend hosting:** Node host (Render/Railway/Fly/VM/etc.) behind HTTPS
- **Persistent image storage:** replace `backend/src/services/storage.js` local driver with Supabase Storage/Cloudinary/S3 for production; DB stores returned HTTPS URLs
- **Required env/security:** `COOKIE_SECURE=true`, correct `CORS_ORIGINS`, `PUBLIC_BASE_URL`, strong `JWT_SECRET`, secrets management

## Useful commands
```bash
# from repo root
docker compose up -d db

# backend
cd backend && npm run migrate && npm run seed:smvitm && npm run dev

# frontend
cd frontend && npm run dev

# full tests/builds
cd frontend && npx tsc --noEmit && npm test && npm run build
cd backend && npm test
```