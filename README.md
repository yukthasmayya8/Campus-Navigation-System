# SMVITM Campus Navigation System

A full-stack campus navigation platform for **Shri Madhwa Vadiraja Institute of Technology and Management (SMVITM), Bantakal, Karnataka**.

The system provides building discovery, verified pedestrian-route alternatives, live GPS guidance, an administrator console, offline public reads, and version-controlled campus data.

[![Backend](https://img.shields.io/badge/Backend-Render-46E3B7)](https://campus-navigation-system-5bj3.onrender.com/api/health)
[![Frontend](https://img.shields.io/badge/Frontend-Vercel-black)](https://campus-navigation-system-izdq-git-main-yuktha7.vercel.app)
[![Database](https://img.shields.io/badge/Database-Neon%20%2B%20PostGIS-00A6FF)](https://neon.com/)
[![License](https://img.shields.io/badge/License-Private-red)](#license)

## Table of contents

- [Key capabilities](#key-capabilities)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Live deployment](#live-deployment)
- [Local development](#local-development)
- [Database setup](#database-setup)
- [Seed accounts](#seed-accounts)
- [Testing](#testing)
- [Production deployment](#production-deployment)
- [Security](#security)
- [Documentation](#documentation)
- [Project team](#project-team)
- [License](#license)

## Key capabilities

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
- Version history, comparison, and restoration
- User management and audit logs

## Architecture

```text
Browser
  |
  | HTTPS
  v
Vercel / Vite React frontend
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
| Hosting | Vercel and Render |

## Live deployment

| Component | URL |
| --- | --- |
| Backend health | https://campus-navigation-system-5bj3.onrender.com/api/health |
| Render API | https://campus-navigation-system-5bj3.onrender.com |
| Vercel project | https://campus-navigation-system-izdq-git-main-yuktha7.vercel.app |

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

The account seed creates or updates the following development accounts:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@smvitm.ac.in` | `SMVITMAdmin@2024` |
| Super Admin | `superadmin@smvitm.ac.in` | `SMVITMSuperAdmin@2024` |

Run it locally or in the Render shell:

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

These credentials are for development and demonstration. Change every default password before production use.

Account definitions are also documented in [`backend/scripts/seed.ts`](backend/scripts/seed.ts).

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
CORS_ORIGINS=<Vercel frontend origin>
PUBLIC_BASE_URL=<Render backend URL>
FRONTEND_URL=<Vercel frontend origin>
```

### Frontend: Vercel

Use repository root configuration:

```text
Framework: Vite
Root Directory: repository root
Build Command: npm run build
Install Command: npm install
Output Directory: frontend/dist
```

Set:

```env
VITE_API_URL=https://campus-navigation-system-5bj3.onrender.com
```

The production value is also kept in [`frontend/.env.production`](frontend/.env.production).

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

## Navigation behavior

Navigation is **recorded-polyline pedestrian guidance**, not turn-by-turn road routing.

The system:

1. Selects a stored, published route.
2. Projects accepted GPS fixes onto route segments.
3. Calculates remaining distance along the walkable polyline.
4. Warns after three accepted fixes more than 30 metres off-route.
5. Declares arrival near the final route segment.
6. Keeps explicit route choices and never silently reroutes.

GPS gaps are represented as interruptions rather than invented straight-line geometry. Seeded route geometry and approximate campus coordinates must be field-verified.

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
