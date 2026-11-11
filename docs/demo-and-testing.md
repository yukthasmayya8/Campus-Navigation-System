# Demo and Testing Guide

## Automated tests

### Frontend
```bash
cd frontend
npx tsc --noEmit
npm test
npm run build
```
- `test/logic.test.js`: GPS filtering/smoothing, path tracking, off-route/arrival, offline route alternatives

### Backend
```bash
cd backend
npm test
```
- `test/logic.test.js`: route reversal/sorting, snapshot diffs, coordinate validation, image sniffing
- `test/integration.test.js`: requires `TEST_DATABASE_URL` (isolated PostgreSQL+PostGIS). Skips if not set.

To run integration tests:
```bash
# Windows PowerShell example
$env:TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/campus_nav_test"
$env:JWT_SECRET="a-very-long-secret-key-at-least-32-chars"
cd backend
npm test
```

## Manual/API verification (Postman/Thunder Client)
Base URL: `http://localhost:4000/api` (or deployed API)

1. **Login**: `POST /auth/login` `{ "email": "...", "password": "..." }` → 200, cookie set, user returned
2. **Create location**: `POST /admin/locations` (auth cookie) with name/lat/lng/description → 201
3. **Update location**: `PUT /admin/locations/:id` with `expectedVersion` → 200; stale `expectedVersion` → 409
4. **Nearest**: `GET /locations/nearest?lat=...&lng=...` → nearest active buildings with distances
5. **Routes**: `GET /routes?from=<id>&to=<id>` → alternatives (including reversed bidirectional where eligible)
6. **Draft/publish route**: `POST /admin/routes`, `POST /admin/routes/:id/points`, `POST /admin/routes/:id/publish` with `expectedVersion`
7. **Image upload**: `POST /admin/uploads/image` multipart `image` → `{ url }`
8. **Restore (Super Admin)**: `POST /admin/locations/:id/restore` or `/admin/routes/:id/restore` with `{ versionNumber, expectedVersion }`
9. **Stale 409**: repeat update/restore/publish with outdated `expectedVersion` and confirm `VERSION_CONFLICT`
10. **AuthZ**: regular admin attempting restore/audit/users endpoints → 403

## GPS/navigation demonstration
- **Live navigation:** use HTTPS/device GPS; start navigation and observe position, accuracy, remaining distance, next waypoint, off-route warning, and arrival screen.
- **Thresholds:** accuracy filter ~30 m, off-route 30 m after 3 consecutive readings, arrival 15 m.
- **Route recording:** `/admin/record` records GPS points (accuracy filtered, spaced), uploads batches, supports waypoints, draft/publish/discard.
- **Weak signal/permission:** deny permission or use poor GPS to observe messages; browser without geolocation shows unsupported message.

## Offline demonstration
1. Open app online, allow data to load/sync (check "Offline data saved" timestamp).
2. Switch browser/network offline.
3. Verify cached buildings/routes/search/nearest fallback behavior and offline indicator.
4. Reconnect and confirm sync/online behavior.

## Demo script (SMVITM)
1. Run migrations and `npm run seed:smvitm` in backend.
2. Login as admin/super admin and review seeded buildings/routes in dashboard.
3. Public app: search "Library" or "Canteen", set start (or use my location), find routes, compare alternatives.
4. Start navigation on mobile/HTTPS and show live tracking, follow-me, recenter, off-route/reroute, arrival.
5. Show offline mode with saved data.
6. Admin: edit a location (version increments), view history/restore (super admin), record or manage route drafts.
