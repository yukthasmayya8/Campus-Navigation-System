import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MapView from '../components/MapView.jsx';
import SearchBox from '../components/SearchBox.jsx';
import LocationDetails from '../components/LocationDetails.jsx';
import { getLocations, searchLocations, getRoutes, getNearest, syncOfflineData, offlineStatus } from '../api.js';
import { PathTracker } from '../lib/tracker.js';
import { formatDistance, formatWalkTime, splitAtTimeGaps } from '../lib/geo.js';

const ARRIVAL_M = 15;
const OFFPATH_M = 30;
const OFFPATH_FIXES = 3;

const inferCategory = (loc) => {
  const text = `${loc.name} ${loc.description || ''}`.toLowerCase();
  if (/library|reading/.test(text)) return 'Library';
  if (/canteen|food|cafeteria|mess|snack/.test(text)) return 'Food';
  if (/admin|office|accounts|principal|placement/.test(text)) return 'Admin';
  if (/sport|ground|gym|play/.test(text)) return 'Sports';
  if (/lab|computer|engineering|block|academic|department|class/.test(text)) return 'Academic';
  return 'Other';
};

const triChip = (value, yes, no) => (
  value === true ? <span className="chip green">✓ {yes}</span>
    : value === false ? <span className="chip red">✗ {no}</span>
      : <span className="chip amber">Not verified</span>
);

const itemFor = (l) => ({ id: l.locationId, label: l.name, sublabel: l.description?.slice(0, 64) || '', icon: '🏢', loc: l });

export default function PublicPage() {
  const [locations, setLocations] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [landed, setLanded] = useState(false);
  const [category, setCategory] = useState('All');
  const [startSel, setStartSel] = useState(null);
  const [destSel, setDestSel] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [routeMsg, setRouteMsg] = useState('');
  const [routeSort, setRouteSort] = useState('recommended');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const [pos, setPos] = useState(null);
  const [navInfo, setNavInfo] = useState(null);
  const [gpsNote, setGpsNote] = useState('');
  const [notice, setNotice] = useState('');
  const [locatingMe, setLocatingMe] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [cache, setCache] = useState({ syncedAt: null, routes: 0 });
  const [followMe, setFollowMe] = useState(true);
  const [detailsId, setDetailsId] = useState(null);
  const [sheet, setSheet] = useState('peek');

  const watchId = useRef(null);
  const tracker = useRef(null);
  const reqSeq = useRef(0);
  const posRef = useRef(null);
  const wakeLock = useRef(null);

  const refreshCache = () => offlineStatus().then(setCache).catch(() => {});
  const loadLocations = useCallback(() => {
    setLoadError('');
    getLocations().then(setLocations).catch((e) => setLoadError(e.message));
  }, []);
  const sync = () => syncOfflineData().then(refreshCache).catch(() => {});

  useEffect(() => {
    loadLocations();
    refreshCache();
    if (navigator.onLine) sync();
    const onOnline = () => { setOnline(true); loadLocations(); sync(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      wakeLock.current?.release?.().catch?.(() => {});
    };
  }, [loadLocations]);

  const fetchSuggestions = useCallback(async (q) => (await searchLocations(q, 8)).map(itemFor), []);

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { wakeLock.current = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
  }
  async function releaseWakeLock() {
    try { await wakeLock.current?.release?.(); } catch { /* ignore */ } finally { wakeLock.current = null; }
  }

  function stopWatch() {
    if (watchId.current !== null) {
      try { navigator.geolocation.clearWatch(watchId.current); } catch { /* ignore */ }
      watchId.current = null;
    }
  }
  function stopNav() {
    stopWatch();
    releaseWakeLock();
    tracker.current = null;
    setNavigating(false); setPos(null); setNavInfo(null); setGpsNote('');
  }

  function resetPlanning() {
    reqSeq.current++;
    stopNav();
    setRoutes(null); setSelected(null); setRouteMsg(''); setNotice(''); setBusy(false);
  }

  function useMyLocation() {
    setGpsNote('');
    if (!('geolocation' in navigator)) { setGpsNote('GPS is not supported in this browser. Pick a starting building instead.'); return; }
    setLocatingMe(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          const nearest = await getNearest(p.coords.latitude, p.coords.longitude);
          if (nearest.length) {
            const l = nearest[0];
            resetPlanning();
            setStartSel(itemFor(l));
            setNotice(`Nearest building: ${l.name} (${formatDistance(l.distanceMeters)} away).`);
            setSheet('half');
          } else setGpsNote('No registered building found near you. Pick a starting building manually.');
        } catch (e) { setGpsNote(e.message); }
        setLocatingMe(false);
      },
      (err) => {
        setGpsNote(err.code === 1
          ? 'Location permission denied. Select your starting building manually.'
          : err.code === 3 ? 'Location request timed out. Try again or pick a starting building.'
            : 'Could not get your location. Pick a starting building manually.');
        setLocatingMe(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );
  }

  async function findRoutes() {
    if (!startSel || !destSel) return;
    const seq = ++reqSeq.current;
    setRoutes(null); setSelected(null); setRouteMsg(''); setNotice(''); stopNav(); setBusy(true); setSheet('half');
    try {
      const data = await getRoutes(startSel.id, destSel.id);
      if (seq !== reqSeq.current) return;
      setRoutes(data.items || []);
      setRouteMsg(data.message || (data.offline ? 'Showing verified routes saved on this device (offline).' : ''));
    } catch (e) {
      if (seq === reqSeq.current) setRouteMsg(e.message);
    } finally {
      if (seq === reqSeq.current) setBusy(false);
    }
  }

  function startNav() {
    if (!selected) return;
    setGpsNote('');
    if (!('geolocation' in navigator)) { setGpsNote('This browser does not support GPS. You can still follow the route on the map.'); return; }
    tracker.current = new PathTracker(selected.points, { offPathMeters: OFFPATH_M, offPathFixes: OFFPATH_FIXES, arrivalMeters: ARRIVAL_M });
    setNavInfo(null);
    setNavigating(true);
    setFollowMe(true);
    setSheet('peek');
    acquireWakeLock();
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        if (!tracker.current) return;
        const r = tracker.current.update({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp });
        if (!r.ok) {
          setGpsNote(r.reason === 'low_accuracy'
            ? `GPS signal weak (±${Math.round(p.coords.accuracy || 0)} m). Waiting for a better fix…`
            : r.reason === 'jump' ? 'Ignored an unreliable GPS jump. Keep walking.'
              : 'Waiting for a valid GPS fix…');
          return;
        }
        setGpsNote(''); setPos({ ...r.position, accuracy: r.accuracy });
        posRef.current = r.position;
        setNavInfo(r);
      },
      (err) => setGpsNote(err.code === 1
        ? 'Location permission denied. Allow location access to navigate.'
        : err.code === 2 ? 'Position unavailable (weak GPS). The route stays visible on the map.'
          : 'Timed out getting your position. Retrying…'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }

  function chooseRoute(r) {
    stopNav();
    setSelected(r);
    setNotice('');
    setSheet('half');
  }

  function chooseDestination(loc) {
    resetPlanning();
    setDestSel(itemFor(loc));
    setDetailsId(null);
    setSheet('half');
  }

  function navigateFromDetails(id) {
    const loc = locations.find((l) => l.locationId === id);
    if (loc) chooseDestination(loc);
  }

  const sameChoice = startSel && destSel && String(startSel.id) === String(destSel.id);
  const canFind = startSel && destSel && !sameChoice && !busy;
  const selectedHasGap = selected ? splitAtTimeGaps(selected.points || []).length > 1 : false;
  const destLoc = destSel?.loc || locations.find((l) => l.locationId === destSel?.id);
  const nextWaypoint = (() => {
    if (!selected || !navInfo) return destSel?.label || null;
    const segment = navInfo.segment ?? 0;
    for (const w of selected.waypoints || []) {
      const loc = locations.find((l) => l.locationId === w.locationId);
      if (!loc) continue;
      let best = Infinity;
      (selected.points || []).forEach((p, i) => {
        const d = Math.hypot(p.latitude - loc.latitude, p.longitude - loc.longitude);
        if (d < best) best = d;
      });
      const idx = (selected.points || []).findIndex((p) => Math.hypot(p.latitude - loc.latitude, p.longitude - loc.longitude) === best);
      if (idx > segment) return w.name || loc.name;
    }
    return destSel?.label || null;
  })();

  const sortedRoutes = (routes || []).slice().sort((a, b) => (
    routeSort === 'shortest'
      ? (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.routeId - b.routeId
      : 0
  ));
  const categories = ['All', ...Array.from(new Set(locations.map(inferCategory))).sort()];
  const visible = locations.filter((l) => category === 'All' || inferCategory(l) === category);
  const detailsOpen = detailsId != null;

  const sheetBody = () => {
    if (detailsOpen) {
      return <LocationDetails locationId={detailsId} onNavigate={navigateFromDetails} onClose={() => setDetailsId(null)} />;
    }

    if (!landed) {
      return (
        <>
          <div className="hero">
            <h2>Find your way around SMVITM</h2>
            <p>Search any campus building, compare verified walking routes and follow live GPS — no login needed.</p>
            <div className="hero-actions">
              <button type="button" className="hero-main" onClick={() => { setLanded(true); setSheet('half'); }}>Plan a walk</button>
              <button type="button" onClick={() => { setLanded(true); setSheet('full'); }}>Browse buildings</button>
            </div>
            <small>Outdoor building-to-building routes recorded by campus administrators.</small>
          </div>
          <div className="stack sm">
            <label htmlFor="landing-search">Where do you want to go?</label>
            <SearchBox
              id="landing-search"
              value={destSel}
              onSelect={(item) => {
                setLanded(true);
                if (item) { resetPlanning(); setDestSel(item); setSheet('half'); }
              }}
              fetchItems={fetchSuggestions}
              placeholder="Search a building or facility…"
            />
            {destLoc && (
              <div className="loc-card">
                <div className="loc-card-body">
                  <div className="loc-card-name">{destLoc.name}</div>
                  <div className="loc-card-desc">{destLoc.description || 'No description available.'}</div>
                </div>
              </div>
            )}
          </div>
        </>
      );
    }

    return (
      <div className="stack">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">{selected ? 'Route details' : navigating ? 'Navigating' : 'Plan your walk'}</div>
            <div className="sheet-sub">SMVITM campus · Bantakal, Udupi</div>
          </div>
          {!navigating && !selected && (
            <button type="button" className="icon ghost" onClick={() => setLanded(false)} aria-label="Show welcome screen">⌂</button>
          )}
        </div>

        {!selected && !navigating && (
          <>
            <div>
              <label htmlFor="start-search">Starting building</label>
              <SearchBox
                id="start-search"
                value={startSel}
                onSelect={(item) => { resetPlanning(); setStartSel(item); if (item) setSheet('half'); }}
                fetchItems={fetchSuggestions}
                placeholder="Search starting point…"
              />
              <button
                type="button"
                className="secondary block"
                style={{ marginTop: 8, fontSize: 13 }}
                onClick={useMyLocation}
                disabled={locatingMe}
              >
                {locatingMe ? 'Detecting location…' : '📍 Use my current location'}
              </button>
              <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                GPS inaccurate? Choose your starting building manually — it always works.
              </p>
            </div>

            <div>
              <label htmlFor="dest-search">Destination</label>
              <SearchBox
                id="dest-search"
                value={destSel}
                onSelect={(item) => { resetPlanning(); setDestSel(item); if (item) setSheet('half'); }}
                fetchItems={fetchSuggestions}
                placeholder="Search destination…"
              />
            </div>

            {sameChoice && <div className="alert warn">Start and destination must be different.</div>}

            <button type="button" className="primary" disabled={!canFind} onClick={findRoutes}>
              {busy ? 'Searching…' : 'Find routes'}
            </button>

            {destLoc && !routes && (
              <div className="loc-card">
                {destLoc.imageUrl
                  ? <img className="loc-card-img" src={destLoc.imageUrl} alt={destLoc.name} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  : <div className="loc-card-img-placeholder">🏢</div>}
                <div className="loc-card-body">
                  <div className="loc-card-name">{destLoc.name}</div>
                  <div className="loc-card-desc">{destLoc.description || 'No description available.'}</div>
                  <button type="button" className="secondary" style={{ marginTop: 9, width: '100%', fontSize: 13 }} onClick={() => setDetailsId(destLoc.locationId)}>
                    View photos & details
                  </button>
                </div>
              </div>
            )}

            {!routes && (
              <div>
                <div className="section-title" style={{ marginBottom: 8 }}>Campus buildings</div>
                <div className="chip-row" role="group" aria-label="Filter by category">
                  {categories.map((c) => (
                    <button key={c} type="button" className={`chip-btn${category === c ? ' active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
                  ))}
                </div>
                {locations.length === 0 && !loadError && <p className="muted">Loading buildings…</p>}
                {locations.length > 0 && visible.length === 0 && <div className="alert info">No buildings in this category.</div>}
                <div className="building-list">
                  {visible.map((l) => (
                    <button key={l.locationId} type="button" className="building-card" onClick={() => chooseDestination(l)}>
                      <b>{l.name}</b>
                      <span>{inferCategory(l)} · {(l.description || 'No description available.').slice(0, 80)}{(l.description || '').length > 80 ? '…' : ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {routeMsg && <div className="alert info">{routeMsg}</div>}

        {routes && !selected && !navigating && (
          <div>
            <div className="section-title" style={{ marginBottom: 8 }}>
              {routes.length} verified route{routes.length === 1 ? '' : 's'}
            </div>
            {routes.length > 1 && (
              <div className="sort-row">
                <button type="button" className={routeSort === 'recommended' ? 'secondary' : ''} onClick={() => setRouteSort('recommended')}>Recommended</button>
                <button type="button" className={routeSort === 'shortest' ? 'secondary' : ''} onClick={() => setRouteSort('shortest')}>Shortest distance</button>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Published routes only. GPS drift? Pick the correct start building and try again.
            </p>
            <div className="route-list">
              {sortedRoutes.map((r) => (
                <button key={r.routeId} type="button" className={`route-card${selected?.routeId === r.routeId ? ' selected' : ''}`} onClick={() => chooseRoute(r)}>
                  <div className="route-card-name">
                    {r.reversed && <span className="chip amber">Reverse</span>}
                    {r.routeName}
                  </div>
                  <div className="route-card-meta">
                    {r.distanceMeters != null && <span>📏 {formatDistance(r.distanceMeters)}</span>}
                    {r.distanceMeters != null && <span>🚶 {formatWalkTime(r.distanceMeters)}</span>}
                  </div>
                  <div className="route-chips">
                    {triChip(r.hasStairs, 'Has stairs', 'No stairs')}
                    {triChip(r.hasRamp, 'Ramp', 'No ramp')}
                    {triChip(r.isCovered, 'Covered', 'Open air')}
                    {r.waypoints?.length > 0 && <span className="chip blue">Via {r.waypoints.length} stop{r.waypoints.length > 1 ? 's' : ''}</span>}
                  </div>
                </button>
              ))}
            </div>
            {routes.length === 0 && <div className="alert info">No verified route is currently available between these buildings.</div>}
          </div>
        )}

        {selected && !navigating && (
          <div className="stack sm">
            {navInfo?.arrived ? (
              <div className="arrived-screen">
                <div className="arrived-icon">🎉</div>
                <div className="arrived-title">You've arrived!</div>
                <div className="arrived-sub">Welcome to {destLoc?.name || destSel?.label}</div>
                <button type="button" className="primary" style={{ marginTop: 14 }} onClick={() => { stopNav(); setSelected(null); setRoutes(null); setNotice(''); }}>
                  Plan another route
                </button>
              </div>
            ) : (
              <>
                <div className="route-card selected">
                  <div className="route-card-name">{selected.routeName}</div>
                  <div className="route-card-meta">
                    {selected.distanceMeters != null && <span>📏 {formatDistance(selected.distanceMeters)}</span>}
                    {selected.distanceMeters != null && <span>🚶 {formatWalkTime(selected.distanceMeters)}</span>}
                  </div>
                  <div className="route-chips">
                    {triChip(selected.hasStairs, 'Has stairs', 'No stairs')}
                    {triChip(selected.hasRamp, 'Ramp', 'No ramp')}
                    {triChip(selected.isCovered, 'Covered', 'Open air')}
                  </div>
                </div>
                {selectedHasGap && (
                  <div className="alert warn">
                    This recorded route has a GPS gap. The line is intentionally broken there — follow the visible path on site.
                  </div>
                )}
                <button type="button" className="primary" onClick={startNav}>Start navigation</button>
                {gpsNote && <div className="alert warn">{gpsNote}</div>}
                <button type="button" onClick={() => { stopNav(); setSelected(null); }}>Choose another route</button>
              </>
            )}
          </div>
        )}

        {navigating && selected && (
          <div className="stack sm">
            {navInfo?.arrived ? (
              <div className="arrived-screen">
                <div className="arrived-icon">🎉</div>
                <div className="arrived-title">You've arrived!</div>
                <div className="arrived-sub">Welcome to {destLoc?.name || destSel?.label}</div>
                <button type="button" className="primary" style={{ marginTop: 14 }} onClick={() => { stopNav(); setSelected(null); setRoutes(null); setNotice(''); }}>
                  Plan another route
                </button>
              </div>
            ) : (
              <>
                <div className="nav-panel">
                  <div className="nav-stats">
                    <div className="nav-stat">
                      <div className="nav-stat-value">{navInfo ? formatDistance(navInfo.remainingMeters) : '—'}</div>
                      <div className="nav-stat-label">Remaining</div>
                    </div>
                    <div className="nav-stat">
                      <div className="nav-stat-value">{navInfo ? formatDistance(navInfo.distanceFromPath) : '—'}</div>
                      <div className="nav-stat-label">From path</div>
                    </div>
                  </div>
                  {pos && (
                    <div className="nav-next" style={{ justifyContent: 'space-between' }}>
                      <span><strong>GPS accuracy</strong></span>
                      <span><span className={`gps-dot ${pos.accuracy <= 30 ? 'good' : 'poor'}`} /> {Math.round(pos.accuracy)} m</span>
                    </div>
                  )}
                  {nextWaypoint && <div className="nav-next"><span>➡</span><span>Next: <strong>{nextWaypoint}</strong></span></div>}
                  {navInfo?.offPath && (
                    <div className="alert warn" style={{ marginBottom: 9 }}>
                      You appear to be off the recorded path. Follow the highlighted line; automatic rerouting is not available.
                    </div>
                  )}
                  {selectedHasGap && (
                    <div className="alert warn" style={{ marginBottom: 9 }}>
                      This route has a recorded GPS gap. The line is intentionally broken; use the visible landmarks and join the continuation on the map.
                    </div>
                  )}
                  {gpsNote && <div className="alert warn" style={{ marginBottom: 9 }}>{gpsNote}</div>}
                  {!pos && !gpsNote && <div className="alert info">Waiting for your first GPS fix…</div>}
                  <div className="nav-actions">
                    <button type="button" onClick={stopNav}>Stop</button>
                    <button type="button" className={followMe ? 'secondary' : ''} onClick={() => setFollowMe((f) => !f)}>
                      {followMe ? 'Following' : 'Follow me'}
                    </button>
                    <button type="button" onClick={() => { if (posRef.current) { setFollowMe(true); setNotice('Map recentered on your position.'); } }}>Recenter</button>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Keep the screen on: some phones pause GPS when locked. No automatic rerouting or route switching is performed.
                </p>
              </>
            )}
          </div>
        )}

        {notice && <div className="alert info">{notice}</div>}
        {loadError && (
          <div className="alert error">
            {loadError} <button type="button" className="link" onClick={loadLocations}>Retry</button>
          </div>
        )}
        <div className="cache-note">
          {cache.syncedAt ? `Offline data saved ${new Date(cache.syncedAt).toLocaleString()}` : 'No offline data saved yet'}
        </div>
      </div>
    );
  };

  return (
    <div className="public-page">
      <div className="map-stage">
        <MapView
          locations={locations}
          route={selected}
          userPosition={pos}
          startId={startSel?.id || null}
          destinationId={destSel?.id || null}
          followMe={followMe && navigating}
          snapUser={navigating && Boolean(selected)}
          onSelectLocation={(l) => { setDetailsId(l.locationId); setLanded(true); setSheet('half'); }}
        />
      </div>

      <header className="public-header">
        <div className="public-brand">
          <span className="brand-icon" aria-hidden="true">🧭</span>
          <span>SMVITM Navigate<small>Bantakal, Udupi</small></span>
        </div>
        <div className="header-actions">
          <span className={`pill-link ${online ? 'online' : ''}`} title={online ? 'Online' : 'Offline — saved data is used'}>
            <span className="gps-dot" style={{ background: online ? 'var(--success)' : 'var(--warn)' }} />
            {online ? 'Online' : 'Offline'}
          </span>
          <Link to="/admin/login" className="pill-link">Admin</Link>
        </div>
      </header>

      {!online && (
        <div className="offline-bar">
          You are offline. {cache.routes ? `Using ${cache.routes} saved route${cache.routes === 1 ? '' : 's'}.` : 'No saved data yet — connect once to enable offline use.'}
        </div>
      )}

      {sheet === 'peek' && !navigating && !detailsOpen && (
        <div className="map-fabs">
          <button type="button" className={`map-fab${followMe ? ' active' : ''}`} onClick={() => setFollowMe((f) => !f)} aria-label="Toggle follow my location" title="Follow my location">🧭</button>
          <button type="button" className="map-fab" onClick={() => setSheet('half')} aria-label="Open route planner" title="Plan a route">🔎</button>
        </div>
      )}

      <section className={`sheet ${sheet}`} aria-label="Navigation panel">
        <button
          type="button"
          className="sheet-handle"
          aria-label={sheet === 'full' ? 'Collapse panel' : 'Expand panel'}
          onClick={() => setSheet((s) => (s === 'full' ? 'half' : s === 'half' ? 'full' : 'half'))}
        />
        <div className="sheet-scroll">{sheetBody()}</div>
      </section>
    </div>
  );
}
