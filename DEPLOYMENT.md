# Deployment & Operations Guide (SMVITM Campus Navigation System)

## Architecture
- **Frontend:** React + Vite app (`frontend/`)
- **Backend:** Node.js + Express API (`backend/`) with PostgreSQL/PostGIS
- **Maps:** OpenStreetMap tiles via Leaflet (client-side)
- **Storage:** Local uploads in development (`backend/uploads` served from `/uploads`); configure persistent object storage for production

> Note: The prompt requested FastAPI; this repository's working architecture is Express and has been preserved/enhanced per "use existing architecture wherever possible."

## Prerequisites
- Node.js >= 18
- npm
- PostgreSQL >= 14 with PostGIS extension available
- HTTPS in production (required for Geolocation in most browsers and for secure cookies/PWA behavior)

## Environment configuration

### Backend (`backend/.env`)
Copy `backend/.env.example` to `backend/.env` and set:

- `DATABASE_URL` – PostgreSQL connection string (PostGIS-enabled database)
- `DATABASE_SSL` – `true` for managed Postgres providers that require TLS
- `JWT_SECRET` – **at least 32 characters**
- `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` (if using `seed:superadmin`)
- `CORS_ORIGINS` – comma-separated allowed frontend origins (e.g. `https://campus.example.edu`)
- `COOKIE_SECURE` – `true` in production (HTTPS)
- `PUBLIC_BASE_URL` – public backend base URL (used for generated image URLs), e.g. `https://api.example.edu`
- `FRONTEND_URL` – frontend URL used in password reset links
- `STORAGE_DRIVER` – currently `local` (dev only). For production use persistent storage and return HTTPS URLs.

### Frontend
- `VITE_API_URL` – backend origin or `/api` base (e.g. `https://api.example.edu` or `https://api.example.edu/api`)
- Prefer same-origin reverse proxy (`/api` and `/uploads`) in production where possible.

## Database setup
```bash
# create database (example)
createdb campus_nav
# or use managed PostgreSQL with PostGIS (Neon/Supabase/etc.)

cd backend
npm install
npm run migrate
npm run seed:superadmin   # optional: create initial super admin
npm run seed:smvitm       # idempotent: 6 buildings + 3 routes for SMVITM (approx coords)
```

### Seed data (SMVITM)
`npm run seed:smvitm` is **idempotent** and creates/updates:
- 6 campus buildings: Main Academic Block, Central Library, Canteen, Computer Science & Engineering Block, Administrative Office Block, Sports & Activity Area
- 3 pedestrian routes with waypoints/metadata
- A super admin (if missing): `admin@smvitm.ac.in` / `SMVITMAdmin@2024` (created with `force_password_change=false` by seed)

**Important:** Building coordinates and route geometries in seed data are approximate. Verify/refine with on-site GPS and the Admin Route Recorder before production use.

## Local development
```bash
# backend
cd backend
npm run dev   # http://localhost:4000

# frontend
cd frontend
npm install
npm run dev   # http://localhost:5173 (proxies /api and /uploads to backend)
```

## Production build & deployment

### Frontend (Netlify/Vercel/static host)
```bash
cd frontend
npm install
npm run build
```
- Deploy `frontend/dist`
- Set `VITE_API_URL` to deployed backend URL
- `netlify.toml` / `vercel.json` are included

### Backend (Node host with PostgreSQL/PostGIS)
```bash
cd backend
npm install --omit=dev
npm run migrate
npm run start
```
- Run behind HTTPS reverse proxy (Nginx/Cloudflare/Render/Railway/etc.)
- Set `COOKIE_SECURE=true`, correct `CORS_ORIGINS`, and `PUBLIC_BASE_URL`
- Ensure `/uploads` is persisted or replace storage driver with object storage (Supabase Storage/Cloudinary/S3)

## Security checklist
- [ ] HTTPS enabled end-to-end
- [ ] `JWT_SECRET` strong and private
- [ ] `COOKIE_SECURE=true` in production
- [ ] `CORS_ORIGINS` restricted to trusted frontend origins
- [ ] Database credentials stored as secrets
- [ ] Admin accounts rotated and least-privilege roles applied
- [ ] Persistent, access-controlled image storage for production

## Offline/PWA notes
- Service worker is registered in production builds (`frontend/src/main.tsx`) and caches app shell + viewed map tiles.
- IndexedDB caches active locations and eligible routes from `/api/offline/snapshot`.
- Admin actions and all writes remain online-only.
- **Not claimed:** server-side rerouting while fully offline. Client falls back to cached routes/data when available.

## Backup and restore (PostgreSQL)

### Backup
Use `pg_dump` (run from a machine with DB access):
```bash
# custom format (recommended)
pg_dump --format=custom --file=campus_nav_$(date +%F).dump "$DATABASE_URL"

# plain SQL
pg_dump --no-owner --no-privileges "$DATABASE_URL" > campus_nav_$(date +%F).sql
```

### Restore
```bash
# custom format
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" campus_nav_YYYY-MM-DD.dump

# plain SQL (to an empty/target DB)
psql "$DATABASE_URL" -f campus_nav_YYYY-MM-DD.sql
```

**Recommendations:**
- Schedule regular automated backups (daily minimum)
- Test restores in a staging database
- Keep backups encrypted and access-controlled
- Back up uploaded images/object storage separately (DB stores URLs/metadata)

## Verification after deployment
1. `GET /api/health` returns `{ status: "ok" }`
2. Admin login works; forced password change flow works for new users
3. Public map loads buildings and routes
4. Route search, nearest-building, and navigation function on HTTPS device
5. Image upload persists across restarts (production storage)
6. `CORS` and cookies behave correctly cross-origin if applicable
