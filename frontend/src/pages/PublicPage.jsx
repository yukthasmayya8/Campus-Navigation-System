import { useEffect, useRef, useState, useCallback } from 'react';
import TopNav from '../components/TopNav.jsx';
import CampusMap from '../components/CampusMap.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { getLocations, getRoutes, getNearest, syncOfflineData, offlineStatus, searchLocations } from '../api.js';
import { PathTracker } from '../lib/tracker.js';
import { locateOnPath } from '../lib/geo.js';

const ARRIVAL_M   = 15;
const OFFPATH_M   = 30;
const OFFPATH_FIX = 3;

function formatDist(m) {
  if (!m && m !== 0) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function formatTime(m) {
  if (!m && m !== 0) return '';
  const mins = Math.round(m / 80); // ~80 m/min walking
  return mins < 1 ? '<1 min' : `~${mins} min`;
}

function chipForBool(val, yes, no) {
  if (val === true)  return <span className="chip green">✓ {yes}</span>;
  if (val === false) return <span className="chip red">✗ {no}</span>;
  return null;
}

export default function PublicPage() {
  const [locations, setLocations]   = useState([]);
  const [loadError, setLoadError]   = useState('');
  const [startSel, setStartSel]     = useState(null);  // {id, label, loc}
  const [destSel, setDestSel]       = useState(null);
  const [routes, setRoutes]         = useState(null);
  const [routeMsg, setRouteMsg]     = useState('');
  const [busy, setBusy]             = useState(false);
  const [selected, setSelected]     = useState(null);
  const [navigating, setNavigating] = useState(false);
  const [pos, setPos]               = useState(null);
  const [navInfo, setNavInfo]       = useState(null);
  const [gpsNote, setGpsNote]       = useState('');
  const [notice, setNotice]         = useState('');
  const [online, setOnline]         = useState(navigator.onLine);
  const [cache, setCache]           = useState({ syncedAt: null, routes: 0 });
  const [followMe, setFollowMe]     = useState(true);
  const [locatingMe, setLocatingMe] = useState(false);

  const watchId  = useRef(null);
  const tracker  = useRef(null);
  const reqSeq   = useRef(0);
  const posRef   = useRef(null);
  const wakeLock = useRef(null);

  // ── Offline / sync ────────────────────────────────────────
  const refreshCache = () => offlineStatus().then(setCache);
  const loadLocations = () => { setLoadError(''); getLocations().then(setLocations).catch((e) => setLoadError(e.message)); };
  const sync = () => syncOfflineData().then(refreshCache).catch(() => {});

  useEffect(() => {
    loadLocations(); refreshCache(); if (navigator.onLine) sync();
    const on = () => { setOnline(true); loadLocations(); sync(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); stopWatch(); releaseWakeLock(); };
  }, []); // eslint-disable-line

  // ── Wake lock ─────────────────────────────────────────────
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock.current = await navigator.wakeLock.request('screen'); }
    catch { /* permission denied or not supported */ }
  }
  async function releaseWakeLock() {
    try { await wakeLock.current?.release(); wakeLock.current = null; } catch {}
  }

  // ── GPS helpers ───────────────────────────────────────────
  function stopWatch() {
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
  }
  function stopNav() {
    stopWatch(); releaseWakeLock();
    tracker.current = null;
    setNavigating(false); setPos(null); setNavInfo(null); setGpsNote('');
  }

  // ── Selection change invalidates everything ───────────────
  function resetAll() {
    reqSeq.current++; stopNav();
    setRoutes(null); setSelected(null); setRouteMsg(''); setNotice(''); setBusy(false);
  }

  // ── Fetch suggestions for SearchInput ────────────────────
  const fetchSuggestions = useCallback(async (q) => {
    const items = await searchLocations(q, 8);
    return items.map((l) => ({ id: l.locationId, label: l.name, sublabel: l.description?.slice(0, 50) || '', icon: '🏢', loc: l }));
  }, []);

  // ── "Use my location" ─────────────────────────────────────
  async function useMyLocation() {
    if (!('geolocation' in navigator)) return setGpsNote('GPS not supported in this browser.');
    setLocatingMe(true); setGpsNote('');
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          const nearest = await getNearest(p.coords.latitude, p.coords.longitude);
          if (nearest.length) {
            const l = nearest[0];
            setStartSel({ id: l.locationId, label: l.name, loc: l });
            setNotice(`📍 Nearest building: ${l.name} (${formatDist(l.distanceMeters)} away)`);
          } else { setGpsNote('No registered buildings found near your location.'); }
        } catch (e) { setGpsNote(e.message); }
        setLocatingMe(false);
      },
      (err) => {
        setGpsNote(err.code === 1 ? 'Location permission denied.' : 'Could not get your location.');
        setLocatingMe(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // ── Find routes ───────────────────────────────────────────
  async function findRoutes() {
    if (!startSel || !destSel) return;
    const seq = ++reqSeq.current;
    setRoutes(null); setSelected(null); setRouteMsg(''); stopNav(); setBusy(true);
    try {
      const d = await getRoutes(startSel.id, destSel.id);
      if (seq !== reqSeq.current) return;
      setRoutes(d.items);
      setRouteMsg(d.message || (d.offline ? '📶 Showing saved routes (offline mode).' : ''));
    } catch (e) {
      if (seq === reqSeq.current) setRouteMsg(e.message);
    } finally { if (seq === reqSeq.current) setBusy(false); }
  }

  // ── Navigation ────────────────────────────────────────────
  function beginTracking(route) {
    tracker.current = new PathTracker(route.points, { offPathMeters: OFFPATH_M, offPathFixes: OFFPATH_FIX, arrivalMeters: ARRIVAL_M });
    setNavInfo(null);
  }

  function startNav() {
    setGpsNote('');
    if (!('geolocation' in navigator))
      return setGpsNote('This browser does not support GPS. You can still view the route on the map.');
    beginTracking(selected);
    setNavigating(true);
    acquireWakeLock();
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        if (!tracker.current) return;
        const r = tracker.current.update({
          latitude: p.coords.latitude, longitude: p.coords.longitude,
          accuracy: p.coords.accuracy, timestamp: p.timestamp,
        });
        if (!r.ok) {
          return setGpsNote(r.reason === 'low_accuracy'
            ? `⚡ GPS signal weak (${Math.round(p.coords.accuracy)} m accuracy). Waiting for better fix…`
            : '⚡ Ignoring an unreliable GPS jump…');
        }
        setGpsNote(''); setPos({ ...r.position, accuracy: r.accuracy });
        posRef.current = r.position; setNavInfo(r);
      },
      (err) => setGpsNote(
        err.code === 1 ? '🔒 Location permission denied. Allow location access to see your position.'
        : err.code === 2 ? '📡 Position unavailable (weak GPS). The route is still shown on the map.'
        : '⏱ Timed out getting your position. Retrying…'
      ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }

  // ── Rerouting ─────────────────────────────────────────────
  async function reroute() {
    const here = posRef.current; if (!here) return;
    const seq = ++reqSeq.current; setNotice('🔍 Looking for another route…');
    const near = (routes || [])
      .filter((r) => r !== selected && locateOnPath(here, r.points).distance <= OFFPATH_M)
      .sort((a, b) => locateOnPath(here, a.points).distance - locateOnPath(here, b.points).distance)[0];
    if (near) {
      setSelected(near); beginTracking(near);
      return setNotice(`↩ Switched to "${near.routeName}", which passes your position.`);
    }
    try {
      const nearest = (await getNearest(here.latitude, here.longitude))
        .find((l) => String(l.locationId) !== String(destSel?.id));
      if (seq !== reqSeq.current) return;
      if (!nearest) return setNotice('You are very close to the destination already.');
      const d = await getRoutes(nearest.locationId, destSel.id);
      if (seq !== reqSeq.current) return;
      if (!d.items.length) return setNotice(`No verified route from ${nearest.name}. Walk back to the path.`);
      stopNav();
      setStartSel({ id: nearest.locationId, label: nearest.name, loc: nearest });
      setRoutes(d.items); setSelected(null);
      setNotice(`↩ New routes from ${nearest.name} (${formatDist(nearest.distanceMeters)} away). Choose one to continue.`);
    } catch (e) { if (seq === reqSeq.current) setNotice(e.message); }
  }

  // ── Next waypoint ─────────────────────────────────────────
  function getNextWaypoint() {
    if (!navInfo || !selected?.waypoints?.length) return null;
    const seg = navInfo.segment ?? 0;
    const pts = selected.points || [];
    for (const w of selected.waypoints) {
      const loc = locations.find((l) => l.locationId === w.locationId);
      if (!loc) continue;
      const wIdx = pts.findIndex((p) => Math.abs(p.latitude - loc.latitude) < 0.0005 && Math.abs(p.longitude - loc.longitude) < 0.0005);
      if (wIdx > seg) return w.name || loc.name;
    }
    return destSel?.label || null;
  }

  // ── Derived state ─────────────────────────────────────────
  const destLoc    = destSel?.loc || locations.find((l) => l.locationId === destSel?.id);
  const sameChoice = startSel && destSel && startSel.id === destSel.id;
  const canSearch  = startSel && destSel && !sameChoice && !busy;
  const nextWP     = getNextWaypoint();

  return (
    <div className="page">
      <TopNav />
      {!online && (
        <div className="offline-bar">
          📶 You are offline. {cache.routes ? `Using ${cache.routes} saved routes.` : 'No saved data yet — connect once to enable offline use.'}
        </div>
      )}

      <div className="layout">
        {/* ── Side Panel ── */}
        <aside className="panel">
          <div>
            <div className="panel-title">Plan Your Walk</div>
            <div className="panel-subtitle">SMVITM Campus Navigation</div>
          </div>

          {loadError && (
            <div className="alert error">{loadError} <button className="link" onClick={loadLocations}>Retry</button></div>
          )}

          {/* From */}
          <div>
            <label htmlFor="start-search">Starting building</label>
            <SearchInput
              id="start-search"
              value={startSel}
              onSelect={(item) => { resetAll(); setStartSel(item); }}
              fetchItems={fetchSuggestions}
              placeholder="Search starting point…"
            />
            <button
              id="use-my-location"
              className="secondary"
              style={{ marginTop: 8, width: '100%', fontSize: 13 }}
              onClick={useMyLocation}
              disabled={locatingMe}
            >
              {locatingMe ? '📡 Detecting…' : '📍 Use my location'}
            </button>
          </div>

          {/* To */}
          <div>
            <label htmlFor="dest-search">Destination</label>
            <SearchInput
              id="dest-search"
              value={destSel}
              onSelect={(item) => { resetAll(); setDestSel(item); }}
              fetchItems={fetchSuggestions}
              placeholder="Search destination…"
            />
          </div>

          {sameChoice && <div className="alert warn">Start and destination must be different.</div>}

          <button
            id="find-routes"
            className="primary"
            disabled={!canSearch}
            onClick={findRoutes}
          >
            {busy ? '⏳ Searching…' : '🗺 Find Routes'}
          </button>

          {/* Destination card */}
          {destLoc && !selected && (
            <div className="loc-card">
              {destLoc.imageUrl
                ? <img src={destLoc.imageUrl} alt={destLoc.name} className="loc-card-img" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                : <div className="loc-card-img-placeholder">🏢</div>}
              <div className="loc-card-body">
                <div className="loc-card-name">{destLoc.name}</div>
                <div className="loc-card-desc">{destLoc.description || 'No description available.'}</div>
              </div>
            </div>
          )}

          {/* Route message */}
          {routeMsg && <div className="alert info">{routeMsg}</div>}

          {/* Route list */}
          {routes && routes.length > 0 && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>
                {routes.length} Route{routes.length > 1 ? 's' : ''} Available
              </div>
              <div className="route-list">
                {routes.map((r) => (
                  <button
                    key={r.routeId}
                    id={`route-${r.routeId}`}
                    className={`route-card${selected?.routeId === r.routeId ? ' selected' : ''}`}
                    onClick={() => { stopNav(); setSelected(r); setNotice(''); }}
                  >
                    <div className="route-card-name">
                      {r.reversed && <span className="chip amber" style={{ marginRight: 6, fontSize: 11 }}>↩ Reverse</span>}
                      {r.routeName}
                    </div>
                    <div className="route-card-meta">
                      {r.distanceMeters != null && <span>📏 {formatDist(r.distanceMeters)}</span>}
                      {r.distanceMeters != null && <span>🚶 {formatTime(r.distanceMeters)}</span>}
                    </div>
                    <div className="route-chips">
                      {chipForBool(r.hasStairs, 'Has stairs', 'No stairs')}
                      {chipForBool(r.hasRamp, 'Ramp', 'No ramp')}
                      {chipForBool(r.isCovered, 'Covered', 'Open air')}
                      {r.waypoints?.length > 0 && <span className="chip blue">Via {r.waypoints.length} stop{r.waypoints.length > 1 ? 's' : ''}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Navigation controls */}
          {selected && (
            <div>
              {navInfo?.arrived ? (
                // Arrived screen
                <div className="arrived-screen">
                  <div className="arrived-icon">🎉</div>
                  <div className="arrived-title">You've Arrived!</div>
                  <div className="arrived-sub">Welcome to {destLoc?.name || destSel?.label}</div>
                  <button className="primary" style={{ marginTop: 14 }} onClick={() => { stopNav(); setSelected(null); setNotice(''); }}>
                    Plan Another Route
                  </button>
                </div>
              ) : navigating ? (
                // Active navigation
                <div className="nav-panel">
                  <div className="nav-stats">
                    <div className="nav-stat">
                      <div className="nav-stat-value">{navInfo ? formatDist(navInfo.remainingMeters) : '—'}</div>
                      <div className="nav-stat-label">Remaining</div>
                    </div>
                    <div className="nav-stat">
                      <div className="nav-stat-value">{navInfo ? formatDist(navInfo.distanceFromPath) : '—'}</div>
                      <div className="nav-stat-label">From Path</div>
                    </div>
                  </div>

                  {nextWP && (
                    <div className="nav-next">
                      <span>➡</span>
                      <span>Next: <strong>{nextWP}</strong></span>
                    </div>
                  )}

                  {navInfo?.offPath && (
                    <div className="alert warn" style={{ marginBottom: 10 }}>
                      ⚠ You appear to be off the path.
                      <button className="link" onClick={reroute} style={{ marginLeft: 8 }}>Find another route</button>
                    </div>
                  )}
                  {gpsNote && <div className="alert warn" style={{ marginBottom: 10 }}>{gpsNote}</div>}
                  {!pos && !gpsNote && <div className="alert info">📡 Waiting for GPS…</div>}

                  <div className="nav-actions">
                    <button onClick={stopNav}>⏹ Stop</button>
                    <button
                      className={followMe ? 'secondary' : ''}
                      id="follow-me"
                      onClick={() => setFollowMe((f) => !f)}
                      title="Follow me on map"
                    >
                      {followMe ? '🔒 Following' : '📍 Follow me'}
                    </button>
                  </div>
                </div>
              ) : (
                // Start nav
                <div>
                  <button className="primary" id="start-navigation" onClick={startNav}>
                    🚶 Start Navigation
                  </button>
                  {gpsNote && <div className="alert warn" style={{ marginTop: 10 }}>{gpsNote}</div>}
                </div>
              )}
            </div>
          )}

          {notice && <div className="alert info">{notice}</div>}

          <div className="muted" style={{ marginTop: 'auto', paddingTop: 8 }}>
            {cache.syncedAt
              ? `✓ Offline data saved ${new Date(cache.syncedAt).toLocaleDateString()}`
              : '⚠ No offline data saved yet'}
          </div>
        </aside>

        {/* ── Map ── */}
        <main className="mapwrap">
          <CampusMap
            locations={locations}
            route={selected}
            userPosition={pos}
            startId={startSel?.id || null}
            destinationId={destSel?.id || null}
            followMe={followMe && navigating}
            snapUser={navigating && !!selected}
          />
        </main>
      </div>
    </div>
  );
}
