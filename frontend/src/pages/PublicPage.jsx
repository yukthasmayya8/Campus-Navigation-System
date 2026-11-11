import { useEffect, useRef, useState, useCallback } from 'react';
import TopNav from '../components/TopNav.jsx';
import CampusMap from '../components/CampusMap.jsx';
import SearchInput from '../components/SearchInput.jsx';
import { getLocations, getRoutes, getNearest, syncOfflineData, offlineStatus, searchLocations } from '../api.js';
import { PathTracker } from '../lib/tracker.js';
import { locateOnPath } from '../lib/geo.js';

const ARRIVAL_M = 15;
const OFFPATH_M = 30;
const OFFPATH_FIX = 3;

function formatDist(m) {
  if (m == null) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function formatTime(m) {
  if (m == null) return '';
  const mins = Math.round(m / 80);
  return mins < 1 ? '<1 min' : `~${mins} min`;
}

function chipForBool(val, yes, no) {
  if (val === true) return <span className="chip green">✓ {yes}</span>;
  if (val === false) return <span className="chip red">✗ {no}</span>;
  return <span className="chip amber">Not verified</span>;
}

function inferCategory(loc) {
  const text = `${loc.name} ${loc.description || ''}`.toLowerCase();
  if (/library|reading/.test(text)) return 'Library';
  if (/canteen|food|cafeteria|mess|snack/.test(text)) return 'Food';
  if (/admin|office|accounts|principal|placement/.test(text)) return 'Administrative';
  if (/sport|ground|gym|play/.test(text)) return 'Sports';
  if (/lab|computer|cs|engineering|block|academic|department|class/.test(text)) return 'Academic';
  return 'Other';
}

export default function PublicPage() {
  const [locations, setLocations] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [startSel, setStartSel] = useState(null);
  const [destSel, setDestSel] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [routeMsg, setRouteMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const [pos, setPos] = useState(null);
  const [navInfo, setNavInfo] = useState(null);
  const [gpsNote, setGpsNote] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [cache, setCache] = useState({ syncedAt: null, routes: 0 });
  const [followMe, setFollowMe] = useState(true);
  const [locatingMe, setLocatingMe] = useState(false);
  const [category, setCategory] = useState('All');

  const watchId = useRef(null);
  const tracker = useRef(null);
  const reqSeq = useRef(0);
  const posRef = useRef(null);
  const wakeLock = useRef(null);

  const refreshCache = () => offlineStatus().then(setCache);
  const loadLocations = () => { setLoadError(''); getLocations().then(setLocations).catch((e) => setLoadError(e.message)); };
  const sync = () => syncOfflineData().then(refreshCache).catch(() => {});

  useEffect(() => {
    loadLocations(); refreshCache(); if (navigator.onLine) sync();
    const on = () => { setOnline(true); loadLocations(); sync(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); stopWatch(); releaseWakeLock(); };
  }, []);

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock.current = await navigator.wakeLock.request('screen'); } catch {}
  }
  async function releaseWakeLock() {
    try { await wakeLock.current?.release(); } catch {} finally { wakeLock.current = null; }
  }

  function stopWatch() {
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
  }
  function stopNav() {
    stopWatch(); releaseWakeLock();
    tracker.current = null;
    setNavigating(false); setPos(null); setNavInfo(null); setGpsNote('');
  }

  function resetAll() {
    reqSeq.current++; stopNav();
    setRoutes(null); setSelected(null); setRouteMsg(''); setNotice(''); setBusy(false);
  }

  const fetchSuggestions = useCallback(async (q) => {
    const items = await searchLocations(q, 8);
    return items.map((l) => ({ id: l.locationId, label: l.name, sublabel: l.description?.slice(0, 60) || '', icon: '🏢', loc: l }));
  }, []);

  async function useMyLocation() {
    if (!('geolocation' in navigator)) return setGpsNote('GPS is not supported in this browser.');
    setLocatingMe(true); setGpsNote('');
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          const nearest = await getNearest(p.coords.latitude, p.coords.longitude);
          if (nearest.length) {
            const l = nearest[0];
            resetAll();
            setStartSel({ id: l.locationId, label: l.name, loc: l });
            setNotice(`Nearest building: ${l.name} (${formatDist(l.distanceMeters)} away)`);
          } else { setGpsNote('No registered buildings found near your location.'); }
        } catch (e) { setGpsNote(e.message); }
        setLocatingMe(false);
      },
      (err) => {
        if (err.code === 1) setGpsNote('Location permission denied. You can still select a starting building manually.');
        else if (err.code === 3) setGpsNote('Location request timed out. Try again or select a starting building manually.');
        else setGpsNote('Could not get your location.');
        setLocatingMe(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
  }

  async function findRoutes() {
    if (!startSel || !destSel) return;
    const seq = ++reqSeq.current;
    setRoutes(null); setSelected(null); setRouteMsg(''); stopNav(); setBusy(true);
    try {
      const d = await getRoutes(startSel.id, destSel.id);
      if (seq !== reqSeq.current) return;
      setRoutes(d.items);
      setRouteMsg(d.message || (d.offline ? 'Showing saved routes (offline mode).' : ''));
    } catch (e) {
      if (seq === reqSeq.current) setRouteMsg(e.message);
    } finally { if (seq === reqSeq.current) setBusy(false); }
  }

  function beginTracking(route) {
    tracker.current = new PathTracker(route.points, { offPathMeters: OFFPATH_M, offPathFixes: OFFPATH_FIX, arrivalMeters: ARRIVAL_M });
    setNavInfo(null);
  }

  function startNav() {
    setGpsNote('');
    if (!selected) return;
    if (!('geolocation' in navigator)) return setGpsNote('This browser does not support GPS. You can still view the route on the map.');
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
            ? `GPS signal weak (${Math.round(p.coords.accuracy)} m). Waiting for better accuracy (≤30 m)…`
            : r.reason === 'jump'
            ? 'Ignored an unreliable GPS jump.'
            : 'Waiting for a valid GPS fix…');
        }
        setGpsNote(''); setPos({ ...r.position, accuracy: r.accuracy });
        posRef.current = r.position; setNavInfo(r);
      },
      (err) => setGpsNote(
        err.code === 1 ? 'Location permission denied. Allow location access to navigate.'
          : err.code === 2 ? 'Position unavailable (weak GPS). The route is still shown on the map.'
            : 'Timed out getting your position. Retrying…'
      ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }

  async function reroute() {
    const here = posRef.current; if (!here) return;
    const seq = ++reqSeq.current; setNotice('Looking for another route…');
    const near = (routes || [])
      .filter((r) => r !== selected && locateOnPath(here, r.points).distance <= OFFPATH_M)
      .sort((a, b) => locateOnPath(here, a.points).distance - locateOnPath(here, b.points).distance)[0];
    if (near) {
      setSelected(near); beginTracking(near);
      return setNotice(`Switched to "${near.routeName}", which passes near your current position.`);
    }
    try {
      const nearest = (await getNearest(here.latitude, here.longitude)).find((l) => String(l.locationId) !== String(destSel?.id));
      if (seq !== reqSeq.current) return;
      if (!nearest) return setNotice('You are very close to the destination already.');
      const d = await getRoutes(nearest.locationId, destSel.id);
      if (seq !== reqSeq.current) return;
      if (!d.items.length) return setNotice(`No verified route from ${nearest.name}. Walk back toward the highlighted path.`);
      stopNav();
      setStartSel({ id: nearest.locationId, label: nearest.name, loc: nearest });
      setRoutes(d.items); setSelected(null);
      setNotice(`New routes from ${nearest.name} (${formatDist(nearest.distanceMeters)} away). Choose one to continue.`);
    } catch (e) { if (seq === reqSeq.current) setNotice(e.message); }
  }

  function getNextWaypoint() {
    if (!navInfo || !selected) return destSel?.label || null;
    if (selected.waypoints?.length) {
      const seg = navInfo.segment ?? 0;
      const pts = selected.points || [];
      for (const w of selected.waypoints) {
        const loc = locations.find((l) => l.locationId === w.locationId);
        if (!loc) continue;
        let bestIdx = -1; let best = Infinity;
        pts.forEach((p, i) => { const d = Math.hypot(p.latitude - loc.latitude, p.longitude - loc.longitude); if (d < best) { best = d; bestIdx = i; } });
        if (bestIdx > seg) return w.name || loc.name;
      }
    }
    return destSel?.label || null;
  }

  const destLoc = destSel?.loc || locations.find((l) => l.locationId === destSel?.id);
  const sameChoice = startSel && destSel && startSel.id === destSel.id;
  const canSearch = startSel && destSel && !sameChoice && !busy;
  const nextWP = getNextWaypoint();
  const categories = ['All', ...Array.from(new Set(locations.map(inferCategory))).sort()];
  const visibleLocations = locations.filter((l) => category === 'All' || inferCategory(l) === category);

  return (
    <div className="page">
      <TopNav />
      {!online && (
        <div className="offline-bar">
          You are offline. {cache.routes ? `Using ${cache.routes} saved routes.` : 'No saved data yet — connect once to enable offline use.'}
        </div>
      )}

      <div className="layout">
        <aside className="panel">
          <div>
            <div className="panel-title">Plan Your Walk</div>
            <div className="panel-subtitle">SMVITM Campus Navigation · Bantakal, Udupi</div>
          </div>

          {loadError && <div className="alert error">{loadError} <button className="link" onClick={loadLocations}>Retry</button></div>}

          <div>
            <label htmlFor="start-search">Starting building</label>
            <SearchInput id="start-search" value={startSel}
              onSelect={(item) => { resetAll(); setStartSel(item); }}
              fetchItems={fetchSuggestions} placeholder="Search starting point…" />
            <button id="use-my-location" className="secondary" style={{ marginTop: 8, width: '100%', fontSize: 13 }} onClick={useMyLocation} disabled={locatingMe}>
              {locatingMe ? 'Detecting location…' : 'Use my current location'}
            </button>
          </div>

          <div>
            <label htmlFor="dest-search">Destination</label>
            <SearchInput id="dest-search" value={destSel}
              onSelect={(item) => { resetAll(); setDestSel(item); }}
              fetchItems={fetchSuggestions} placeholder="Search destination…" />
          </div>

          {sameChoice && <div className="alert warn">Start and destination must be different.</div>}

          <button id="find-routes" className="primary" disabled={!canSearch} onClick={findRoutes}>
            {busy ? 'Searching…' : 'Find Routes'}
          </button>

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

          {!selected && !routes && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>Campus Buildings</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {categories.map((c) => (
                  <button key={c} type="button" className={category === c ? 'secondary' : ''} style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setCategory(c)}>{c}</button>
                ))}
              </div>
              {locations.length === 0 && !loadError ? (
                <div className="muted">Loading buildings…</div>
              ) : visibleLocations.length === 0 ? (
                <div className="alert info">No buildings in this category.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                  {visibleLocations.slice(0, 8).map((l) => (
                    <button key={l.locationId} type="button" className="route-card" onClick={() => { resetAll(); setDestSel({ id: l.locationId, label: l.name, loc: l }); }}>
                      <div className="route-card-name">{l.name}</div>
                      <div className="route-card-meta"><span className="chip blue" style={{ fontSize: 11 }}>{inferCategory(l)}</span></div>
                      <div className="muted" style={{ fontSize: 12 }}>{(l.description || 'No description available.').slice(0, 90)}{(l.description || '').length > 90 ? '…' : ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {routeMsg && <div className="alert info">{routeMsg}</div>}

          {routes && routes.length > 0 && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>{routes.length} Route{routes.length > 1 ? 's' : ''} Available</div>
              <div className="route-list">
                {routes.map((r) => (
                  <button key={r.routeId} id={`route-${r.routeId}`}
                    className={`route-card${selected?.routeId === r.routeId ? ' selected' : ''}`}
                    onClick={() => { stopNav(); setSelected(r); setNotice(''); }}>
                    <div className="route-card-name">
                      {r.reversed && <span className="chip amber" style={{ marginRight: 6, fontSize: 11 }}>Reverse</span>}
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

          {selected && (
            <div>
              {navInfo?.arrived ? (
                <div className="arrived-screen">
                  <div className="arrived-icon">🎉</div>
                  <div className="arrived-title">You've Arrived!</div>
                  <div className="arrived-sub">Welcome to {destLoc?.name || destSel?.label}</div>
                  <button className="primary" style={{ marginTop: 14 }} onClick={() => { stopNav(); setSelected(null); setRoutes(null); setNotice(''); }}>Plan Another Route</button>
                </div>
              ) : navigating ? (
                <div className="nav-panel">
                  <div className="nav-stats">
                    <div className="nav-stat"><div className="nav-stat-value">{navInfo ? formatDist(navInfo.remainingMeters) : '—'}</div><div className="nav-stat-label">Remaining</div></div>
                    <div className="nav-stat"><div className="nav-stat-value">{navInfo ? formatDist(navInfo.distanceFromPath) : '—'}</div><div className="nav-stat-label">From Path</div></div>
                  </div>
                  {pos && <div className="nav-next" style={{ justifyContent: 'space-between' }}><span><strong>GPS accuracy</strong></span><span><span className={`gps-dot ${pos.accuracy <= 30 ? 'good' : 'poor'}`}></span> {Math.round(pos.accuracy)} m</span></div>}
                  {nextWP && <div className="nav-next"><span>➡</span><span>Next: <strong>{nextWP}</strong></span></div>}
                  {navInfo?.offPath && <div className="alert warn" style={{ marginBottom: 10 }}>You appear to be off the path. <button className="link" onClick={reroute} style={{ marginLeft: 8 }}>Find another route</button></div>}
                  {gpsNote && <div className="alert warn" style={{ marginBottom: 10 }}>{gpsNote}</div>}
                  {!pos && !gpsNote && <div className="alert info">Waiting for GPS…</div>}
                  <div className="nav-actions">
                    <button onClick={stopNav}>Stop</button>
                    <button className={followMe ? 'secondary' : ''} onClick={() => setFollowMe((f) => !f)} title="Follow me on map">{followMe ? 'Following' : 'Follow me'}</button>
                    <button onClick={() => { if (posRef.current) { setFollowMe(true); setNotice('Map recentered to your location.'); } }} title="Recenter">Recenter</button>
                  </div>
                </div>
              ) : (
                <div>
                  <button className="primary" id="start-navigation" onClick={startNav}>Start Navigation</button>
                  {gpsNote && <div className="alert warn" style={{ marginTop: 10 }}>{gpsNote}</div>}
                </div>
              )}
            </div>
          )}

          {notice && <div className="alert info">{notice}</div>}

          <div className="muted" style={{ marginTop: 'auto', paddingTop: 8 }}>
            {cache.syncedAt ? `Offline data saved ${new Date(cache.syncedAt).toLocaleString()}` : 'No offline data saved yet'}
          </div>
        </aside>

        <main className="mapwrap">
          <CampusMap locations={locations} route={selected} userPosition={pos}
            startId={startSel?.id || null} destinationId={destSel?.id || null}
            followMe={followMe && navigating} snapUser={navigating && !!selected} />
        </main>
      </div>
    </div>
  );
}
