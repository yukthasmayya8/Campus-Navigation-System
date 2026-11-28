# Demo and Testing Guide

## Automated tests

### Frontend
```bash
cd frontend
npx tsc --noEmit
npm test
npm run build
```
- `test/logic.test.js`: GPS filtering/smoothing (including stale/out-of-order fixes), path tracking, off-route/arrival, raw GPS vs route projection, offline route alternatives
- `test/buildingDetection.test.js`: approximate/verified building detection, hysteresis, between/outside cases, source separation
- `test/geolocation.test.js`: fresh-fix capture, accuracy/timestamp metadata, validation, cancellation, coordinate-form validation
- `test/routeGraph.test.js`: graph non-mutation, missing verified paths, and confirmation-only reroute candidates

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
4. **Nearest**: `GET /locations/nearest?lat=...&lng=...` → nearest active reference coordinates with distances; this is not a current-building or navigation-source claim
5. **Routes**: `GET /routes?from=<id>&to=<id>` → alternatives (including reversed bidirectional where eligible)
6. **Draft/publish route**: `POST /admin/routes`, `POST /admin/routes/:id/points`, `POST /admin/routes/:id/publish` with `expectedVersion`
7. **Image upload**: `POST /admin/uploads/image` multipart `image` → `{ url }`
8. **Restore (Super Admin)**: `POST /admin/locations/:id/restore` or `/admin/routes/:id/restore` with `{ versionNumber, expectedVersion }`
9. **Stale 409**: repeat update/restore/publish with outdated `expectedVersion` and confirm `VERSION_CONFLICT`
10. **AuthZ**: regular admin attempting restore/audit/users endpoints → 403

## GPS/navigation demonstration
- **Live navigation:** use HTTPS/device GPS; start navigation and observe the raw GPS marker/accuracy circle, separate route projection, route total, remaining distance, next waypoint, off-route warning, confirmation-only reroute candidate, and arrival screen.
- **Thresholds:** capture/building accuracy 30 m target (40 m hard ceiling for any building claim, 30 m for verified boundaries), route-filter accuracy 30 m, off-route 30 m after 3 consecutive readings, arrival 15 m, stale fixes rejected after 15–20 s.
- **Admin capture:** enter name/details, tap **Capture My Current Location**, wait for a fresh fix, review coordinates/accuracy/timestamp, retry/cancel if needed, then save. Manually edit the pin only as an explicit fallback.
- **Route recording:** `/admin/record` records GPS points (accuracy filtered, spaced), uploads batches, supports waypoints, draft/publish/discard.
- **Weak signal/permission:** deny permission or use poor GPS to observe messages; browser without geolocation shows unsupported message.

### Real-phone verification checklist

Use a physical phone on mobile data or Wi-Fi, not a desktop browser with a simulated location.

1. Open `https://campus-navigation-system-smvitm.netlify.app` and accept the location prompt. Confirm HTTPS is shown; HTTP must explain that GPS is unavailable.
2. Stand outside a known building. Tap **Use my current location**. Verify the blue GPS marker sits at your actual position, the card shows latitude/longitude/accuracy/time, and any building name says **approximate** unless a verified boundary was explicitly added. Confirm no start field was filled automatically.
3. If the suggestion is correct, tap **Use <building> as start (approximate)**; otherwise choose the correct building manually. Verify changing start/destination never silently switches the other endpoint.
4. Find routes between two buildings and start navigation. Walk the published path. Confirm “Remaining on route” decreases, “Route total” stays fixed, GPS accuracy changes with signal, and the projected marker stays on the line while the GPS marker can be off it.
5. Step 30+ m off the path for three fixes. Confirm the route is not switched automatically, a verified candidate appears only when published geometry supports it, and tapping **Switch to verified path** keeps the destination unchanged. If no candidate appears, confirm the message says no verified alternative exists.
6. Lock the screen/background the tab briefly, then return. Confirm the recorded route/progress is unchanged and a notice explains any GPS pause.
7. Move indoors or cover the phone to degrade accuracy. Confirm poor/stale fixes are ignored with a clear message and the last valid route progress is not corrupted.
8. Admin phone check: sign in, open Campus locations → Add location, fill name/details, tap **Capture My Current Location**, retry once, verify displayed coordinates/accuracy/timestamp match the phone fix, drag the pin manually if needed, save, and confirm version/history are updated.
9. Toggle airplane mode after data loads. Confirm the offline banner, cached locations/routes, and that live GPS still tracks on the published path without fabricated rerouting.
10. Repeat on iOS Safari and Android Chrome if both are available; mobile browsers can suspend GPS when backgrounded.

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
