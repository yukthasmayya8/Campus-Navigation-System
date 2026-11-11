import { useEffect, useRef, useState } from 'react';
import TopNav from '../components/TopNav.jsx';
import CampusMap from '../components/CampusMap.jsx';
import CampusSearch from '../components/CampusSearch (2).jsx';
import RouteAlternatives from '../components/RouteAlternatives.jsx';
import { getLocations, getRoutes, getNearest, syncOfflineData, offlineStatus } from '../api.js';
import { PathTracker } from '../lib/tracker.js';
import { locateOnPath } from '../lib/geo.js';

/*
 * Public shell. Plug-in points for teammates (Stage 2): <CampusSearch/> replaces the destination <select>,
 * <LocationDetails/> replaces the small info block.
 */
export default function PublicPage() {
  const [locations, setLocations] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [startId, setStartId] = useState('');
  const [destId, setDestId] = useState('');
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
  const watchId = useRef(null);
  const tracker = useRef(null);
  const reqSeq = useRef(0);   // bumped on EVERY selection change and every search -> stale responses are ignored
  const posRef = useRef(null);

  const refreshCacheInfo = () => offlineStatus().then(setCache);

  const loadLocations = () => { setLoadError(''); getLocations().then(setLocations).catch((e) => setLoadError(e.message)); };
  const sync = () => syncOfflineData().then(refreshCacheInfo).catch(() => { /* offline or server asleep: keep old cache */ });

  useEffect(() => {
    loadLocations(); refreshCacheInfo(); if (navigator.onLine) sync();
    const on = () => { setOnline(true); loadLocations(); sync(); }; const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); stopWatch(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopWatch() {
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
  }
  function stopNav() { stopWatch(); tracker.current = null; setNavigating(false); setPos(null); setNavInfo(null); setGpsNote(''); }

  /** Any change to start/destination invalidates in-flight requests, results and navigation. */
  function changeSelection(setter, value) {
    reqSeq.current++; setBusy(false); stopNav(); setRoutes(null); setSelected(null); setRouteMsg(''); setNotice(''); setter(value ? String(value) : '');
  }

  async function findRoutes(from = startId, to = destId) {
    const seq = ++reqSeq.current;
    setRoutes(null); setSelected(null); setRouteMsg(''); stopNav(); setBusy(true);
    try {
      const d = await getRoutes(from, to);
      if (seq !== reqSeq.current) return;           // user changed selection meanwhile: drop this response
      setRoutes(d.items); setRouteMsg(d.message || (d.offline ? 'Showing saved routes (offline).' : ''));
    } catch (e) {
      if (seq === reqSeq.current) setRouteMsg(e.message);
    } finally { if (seq === reqSeq.current) setBusy(false); }
  }

  function beginTracking(route) {
    tracker.current = new PathTracker(route.points);
    setNavInfo(null);
  }
  function startNav() {
    setGpsNote('');
    if (!('geolocation' in navigator)) return setGpsNote('This browser does not support location. You can still view the route on the map.');
    beginTracking(selected); setNavigating(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        if (!tracker.current) return;
        const r = tracker.current.update({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp });
        if (!r.ok) return setGpsNote(r.reason === 'low_accuracy' ? 'GPS signal is weak; waiting for a better fix…' : 'Ignoring an unreliable GPS jump…');
        setGpsNote(''); setPos(r.position); posRef.current = r.position; setNavInfo(r);
      },
      (err) => setGpsNote(err.code === 1 ? 'Location permission denied. Allow location access to see your position.'
        : err.code === 2 ? 'Your position is unavailable (weak GPS signal). The route is still shown.' : 'Timed out getting your position. Retrying…'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  /**
   * Rerouting = choosing another VERIFIED recorded path (the system never invents paths):
   *  1) another alternative for the same trip that passes where the user is now, else
   *  2) the nearest registered building becomes the new start and its recorded routes to the destination are offered.
   */
  async function reroute() {
    const here = posRef.current; if (!here) return;
    const seq = ++reqSeq.current; setNotice('Looking for another route…');
    const near = (routes || []).filter((r) => r !== selected && locateOnPath(here, r.points).distance <= 30)
      .sort((a, b) => locateOnPath(here, a.points).distance - locateOnPath(here, b.points).distance)[0];
    if (near) { setSelected(near); beginTracking(near); return setNotice(`Switched to "${near.routeName}", which passes your position.`); }
    try {
      const nearest = (await getNearest(here.latitude, here.longitude)).find((l) => String(l.locationId) !== String(destId));
      if (seq !== reqSeq.current) return;
      if (!nearest) return setNotice('You are close to the destination.');
      const d = await getRoutes(nearest.locationId, destId);
      if (seq !== reqSeq.current) return;
      if (!d.items.length) return setNotice(`No verified route from ${nearest.name} to the destination. Walk back to the path or to a known building.`);
      stopNav(); setStartId(String(nearest.locationId)); setRoutes(d.items); setSelected(null);
      setNotice(`New routes from ${nearest.name} (${nearest.distanceMeters} m from you). Choose one to continue.`);
    } catch (e) { if (seq === reqSeq.current) setNotice(e.message); }
  }

  const dest = locations.find((l) => String(l.locationId) === String(destId));
  const sameChoice = startId && destId && startId === destId;
  const canSearch = startId && destId && !sameChoice && !busy;
  const syncedText = cache.syncedAt ? `Offline data saved ${new Date(cache.syncedAt).toLocaleString()}` : 'Offline data not saved yet';

  return (
    <div className="page">
      <TopNav />
      {!online && <div className="offline-bar">You are offline. {cache.routes ? 'Using saved campus data.' : 'No saved data on this device yet.'}</div>}
      <div className="layout">
        <aside className="panel">
          <h2>Plan your walk</h2>
          {loadError && <div className="alert error">{loadError} <button className="link" onClick={loadLocations}>Retry</button></div>}

          <label>Starting building
            <CampusSearch
              placeholder="Search for a starting building"
              onSelect={({ locationId }) => changeSelection(setStartId, locationId)}
              onClear={() => changeSelection(setStartId, '')}
            />
          </label>
          <label>Destination
            <CampusSearch
              placeholder="Search for a destination"
              onSelect={({ locationId }) => changeSelection(setDestId, locationId)}
              onClear={() => changeSelection(setDestId, '')}
            />
          </label>
          {sameChoice && <div className="alert warn">Start and destination must be different.</div>}
          <button className="primary" disabled={!canSearch} onClick={() => findRoutes()}>{busy ? 'Searching…' : 'Find routes'}</button>

          {dest && (
            <div className="info">
              {dest.imageUrl && <img src={dest.imageUrl} alt={dest.name} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              <strong>{dest.name}</strong>
              <p>{dest.description || 'No description available.'}</p>
            </div>
          )}

          {routeMsg && <div className="alert info-box">{routeMsg}</div>}
          {routes && routes.length > 0 && (<>
            <h3>{routes.length} route{routes.length > 1 ? 's' : ''} available</h3>
            <RouteAlternatives routes={routes} selectedId={selected?.routeId} onSelect={(r) => { stopNav(); setSelected(r); setNotice(''); }} />
          </>)}

          {selected && (
            <div className="nav-controls">
              {!navigating ? <button className="primary" onClick={startNav}>Start navigation</button> : <button onClick={stopNav}>Stop navigation</button>}
              {navigating && navInfo && !navInfo.arrived && (
                <div className="stats"><div className="stat"><b>{navInfo.remainingMeters} m</b>remaining</div><div className="stat"><b>{navInfo.distanceFromPath} m</b>from path</div></div>
              )}
              {navInfo?.arrived && <div className="alert info-box">You have arrived at your destination.</div>}
              {navInfo?.offPath && !navInfo.arrived && (
                <div className="alert warn">You appear to be off the recorded path. <button className="link" onClick={reroute}>Find another route</button></div>
              )}
              {gpsNote && <div className="alert warn">{gpsNote}</div>}
              {navigating && !pos && !gpsNote && <div className="alert info-box">Waiting for GPS…</div>}
            </div>
          )}
          {notice && <div className="alert info-box">{notice}</div>}
          <small className="muted">{syncedText}</small>
        </aside>
        <main className="mapwrap">
          <CampusMap locations={locations} route={selected} userPosition={pos}
            startId={Number(startId) || null} destinationId={Number(destId) || null} />
        </main>
      </div>
    </div>
  );
}
