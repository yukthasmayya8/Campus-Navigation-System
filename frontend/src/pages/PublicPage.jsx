import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MapView from '../components/MapView.jsx';
import SearchBox from '../components/SearchBox.jsx';
import LocationDetails from '../components/LocationDetails.jsx';
import { getLocations, searchLocations, getRoutes, syncOfflineData, offlineStatus, api } from '../api.js';
import { PathTracker } from '../lib/tracker.js';
import { formatDistance, splitAtTimeGaps, GAP_AFTER_MS } from '../lib/geo.js';
import { buildGraph, routeFromPosition, pathGeometry, nearestNode, alternativeFromPosition } from '../lib/routeGraph.js';
import { resolveBuilding, trackBuilding, navigationSource, formatBuildingStatus } from '../lib/buildingDetection.js';
import { captureBestPosition, normalisePosition, secureContextAllowed, gpsConfidence } from '../lib/geolocation.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { backgroundHint, wakeLockHint } from '../lib/platform.js';
import RouteFacts from '../components/RouteFacts.jsx';

const ARRIVAL_M = 15;
const OFFPATH_M = 30;
const OFFPATH_FIXES = 3;

let initialNotice = null;

const inferCategory = (loc) => {
  const text = `${loc.name} ${loc.description || ''}`.toLowerCase();
  if (/library|reading/.test(text)) return 'Library';
  if (/canteen|food|cafeteria|mess|snack/.test(text)) return 'Food';
  if (/admin|office|accounts|principal|placement/.test(text)) return 'Admin';
  if (/sport|ground|gym|play/.test(text)) return 'Sports';
  if (/lab|computer|engineering|block|academic|department|class/.test(text)) return 'Academic';
  return 'Other';
};

const itemFor = (l) => ({ id: l.locationId, label: l.name, sublabel: l.description?.slice(0, 64) || '', icon: '🏢', loc: l });

const formatFixLine = (fix) => {
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return '';
  const accuracy = Number.isFinite(fix.accuracy) ? ` · ±${Math.round(fix.accuracy)} m` : '';
  const time = Number.isFinite(fix.timestamp) ? ` · ${new Date(fix.timestamp).toLocaleTimeString()}` : '';
  return `${Number(fix.latitude).toFixed(6)}, ${Number(fix.longitude).toFixed(6)}${accuracy}${time}`;
};

export default function PublicPage() {
  // Public data and panel state.
  const [locations, setLocations] = useState([]);
  const [detailsId, setDetailsId] = useState(null);
  const [sheet, setSheet] = useState('peek');
  const [allRoutes, setAllRoutes] = useState([]);
  const [graph, setGraph] = useState(null);
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
  // Separate state: raw device GPS, filtered position used for route math, and building suggestion.
  const [rawGps, setRawGps] = useState(null);
  const [gpsState, setGpsState] = useState('initializing');
  const [filteredGps, setFilteredGps] = useState(null);
  const [currentBuilding, setCurrentBuilding] = useState(null);
  const [routeSourceLabel, setRouteSourceLabel] = useState('');
  const [navInfo, setNavInfo] = useState(null);
  const [gpsNote, setGpsNote] = useState('');
  const [notice, setNotice] = useState(() => {
    try {
      const m = sessionStorage.getItem('campus-nav-notice');
      if (m) { sessionStorage.removeItem('campus-nav-notice'); initialNotice = m; return m; }
      if (initialNotice) { const m = initialNotice; initialNotice = null; return m; }
    } catch { /* ignore */ }
    return '';
  });
  const [locatingMe, setLocatingMe] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [cache, setCache] = useState({ syncedAt: null, routes: 0 });
  const [followMe, setFollowMe] = useState(true);
  const [reroute, setReroute] = useState(null);
  const rerouteCooldown = useRef(0);

  const watchId = useRef(null);
  const tracker = useRef(null);
  const reqSeq = useRef(0);
  const posRef = useRef(null); // last raw device fix, used only for map recentering
  const currentBuildingRef = useRef(null);
  const navigatingRef = useRef(false);
  const hiddenAtRef = useRef(null);
  const locationsRef = useRef(locations);
  const destSelRef = useRef(destSel);
  const selectedRef = useRef(selected);
  const graphRef = useRef(graph);
  locationsRef.current = locations;
  destSelRef.current = destSel;
  selectedRef.current = selected;
  graphRef.current = graph;
  const wake = useWakeLock(navigating);

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
    // Load all published routes so the graph can connect recorded paths and support
    // navigation from arbitrary (including intermediate) positions.
    (async () => {
      try {
        const snap = await api('/offline/snapshot');
        setAllRoutes(snap.routes || []);
        setGraph(buildGraph(snap.routes || []));
      } catch { /* offline or unavailable; keep empty graph */ }
    })();
    const onOnline = () => { setOnline(true); loadLocations(); sync(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      wake.release();
    };
  }, [loadLocations]);

  // Keep the same recorded route across tab suspension / screen lock, but never
  // auto-reroute or switch routes. A long backgrounding only produces a notice.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (navigatingRef.current) hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;
      if (!navigatingRef.current) return;
      if (hiddenFor > GAP_AFTER_MS) {
        setGpsNote('GPS was paused while this tab was in the background or the screen was locked. The recorded route and your progress are unchanged; no rerouting was performed. Keep the screen on and wait for the next fix.');
      } else if (hiddenFor > 3000) {
        setGpsNote('Back in the app. Mobile browsers can pause GPS in the background; waiting for a fresh fix.');
      }
      wake.acquire();
      startWatch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [wake]);

  const fetchSuggestions = useCallback(async (q) => (await searchLocations(q, 8)).map(itemFor), []);

  function stopWatch() {
    if (watchId.current !== null) {
      try { navigator.geolocation.clearWatch(watchId.current); } catch { /* ignore */ }
      watchId.current = null;
    }
  }

  const gpsReasonNote = (reason, accuracy) => ({
    low_accuracy: `GPS signal weak (±${Math.round(accuracy || 0)} m). Waiting for a better fix…`,
    jump: 'Ignored an unreliable GPS jump. The route and progress are unchanged.',
    stale: 'The last GPS fix was old. Waiting for a fresh position; no route change was made.',
    invalid: 'Ignoring invalid GPS coordinates.',
    no_path: 'No walkable route geometry is available for this route.',
  }[reason] || 'Waiting for a valid GPS fix…');

  function observeBuilding(fix) {
    const observation = resolveBuilding(fix, locationsRef.current);
    const next = trackBuilding(currentBuildingRef.current, observation);
    currentBuildingRef.current = next;
    setCurrentBuilding(next);
    return next;
  }

  /** Off-route handling: only published graph geometry, and never an automatic route switch. */
  function considerReroute(r) {
    if (!r.offPath || !destSelRef.current?.id || Date.now() - rerouteCooldown.current < 30000) return;
    rerouteCooldown.current = Date.now();
    const activeGraph = graphRef.current;
    if (!activeGraph) {
      setReroute({ message: 'No published route graph is available on this device. Follow the recorded path or return to it.' });
      return;
    }
    const destLoc = destSelRef.current.loc || locationsRef.current.find((l) => l.locationId === destSelRef.current.id);
    if (!destLoc) return;
    const destNode = nearestNode(activeGraph, destLoc.latitude, destLoc.longitude);
    if (!destNode || destNode.distance > 60) {
      setReroute({ message: 'No verified route ends near your destination. The active route is unchanged.' });
      return;
    }
    const candidate = alternativeFromPosition(activeGraph, r.position, destNode.node.id, selectedRef.current?.points || [], { maxSnapM: 25 });
    setReroute(candidate
      ? { candidate, message: 'A verified path from your current position is available. Switch only if you want to.' }
      : { message: 'No verified alternative route from your current position. Follow the recorded path or return to it.' });
  }

  function startWatch() {
    if (!('geolocation' in navigator)) {
      setGpsNote('This browser does not support GPS. You can still follow the route on the map.');
      return;
    }
    if (!secureContextAllowed()) {
      setGpsNote('GPS requires HTTPS. Open this site over https:// to use live navigation.');
      return;
    }
    stopWatch();
    try {
      watchId.current = navigator.geolocation.watchPosition(
        (p) => {
          const fix = normalisePosition(p);
          // Raw device position is displayed on the map; it is never replaced by a
          // building reference coordinate or by a projected route point.
          setRawGps(fix);
          posRef.current = fix;
          const building = observeBuilding(fix);
          const confidence = gpsConfidence(fix);
          setGpsState(building?.status === 'between' ? 'ambiguous'
            : building?.status === 'outside' ? 'outside'
              : confidence === 'stale' ? 'stale'
                : confidence === 'low' ? 'low'
                  : confidence === 'moderate' ? 'moderate' : 'high');
          if (!tracker.current) return;
          const r = tracker.current.update(fix);
          if (!r.ok) { setGpsNote(gpsReasonNote(r.reason, fix.accuracy)); return; }
          setGpsNote('');
          setFilteredGps({ ...r.position, accuracy: r.accuracy });
          setNavInfo(r);
          if (r.offPath) considerReroute(r);
          else if (reroute) setReroute(null);
        },
        (err) => {
          setGpsState(err.code === 1 ? 'unavailable' : 'low');
          setGpsNote(err.code === 1
            ? 'Location permission denied. Allow location access in your browser settings.'
            : err.code === 2 ? 'Position unavailable. The recorded route remains visible; retry when GPS returns.'
              : 'Timed out getting your position. Retrying…');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      setGpsNote('Could not start GPS tracking. Check browser location permissions.');
    }
  }

  function startNav(route = selectedRef.current) {
    if (!route) return;
    setGpsNote('');
    if (!('geolocation' in navigator) || !secureContextAllowed()) {
      setGpsNote('Live GPS needs a modern browser over HTTPS (or localhost). You can still follow the route on the map.');
      return;
    }
    const segments = route.segments?.length ? route.segments : splitAtTimeGaps(route.points || []);
    tracker.current = new PathTracker(route.points || [], {
      segments, offPathMeters: OFFPATH_M, offPathFixes: OFFPATH_FIXES, arrivalMeters: ARRIVAL_M,
    });
    setSelected(route);
    setNavInfo(null);
    setFilteredGps(null);
    setReroute(null);
    rerouteCooldown.current = 0;
    setNavigating(true);
    navigatingRef.current = true;
    setFollowMe(true);
    setSheet('peek');
    wake.acquire();
    startWatch();
  }

  function stopNav() {
    stopWatch();
    wake.release();
    tracker.current = null;
    navigatingRef.current = false;
    setNavigating(false);
    // Raw GPS and current-building state are intentionally kept: they describe the device,
    // not the active route. Only navigation-derived state is cleared here.
    setFilteredGps(null); setNavInfo(null); setReroute(null); setGpsNote('');
  }

  async function retryGps() {
    if (!tracker.current) return;
    setLocatingMe(true);
    try {
      const { fix, warning } = await captureBestPosition();
      setRawGps(fix);
      posRef.current = fix;
      const building = observeBuilding(fix);
      const confidence = gpsConfidence(fix);
      setGpsState(building?.status === 'between' ? 'ambiguous'
        : building?.status === 'outside' ? 'outside'
          : confidence === 'stale' ? 'stale'
            : confidence === 'low' ? 'low'
              : confidence === 'moderate' ? 'moderate' : 'high');
      const r = tracker.current.update(fix);
      if (r.ok) {
        setGpsNote(warning || '');
        setFilteredGps({ ...r.position, accuracy: r.accuracy });
        setNavInfo(r);
      } else setGpsNote(gpsReasonNote(r.reason, fix.accuracy));
    } catch (e) { setGpsNote(e.message || 'Could not get your position. Move outdoors and retry.'); }
    finally { setLocatingMe(false); }
  }

  async function routeFromMyLocation() {
    if (!destSel) { setNotice('Select a destination first.'); return; }
    if (!graph) { setNotice('Published route data is not available on this device yet. Connect once to download it.'); return; }
    setGpsNote('');
    setLocatingMe(true);
    try {
      const { fix, warning } = await captureBestPosition();
      setRawGps(fix);
      posRef.current = fix;
      const building = observeBuilding(fix);
      const confidence = gpsConfidence(fix);
      setGpsState(building?.status === 'between' ? 'ambiguous'
        : building?.status === 'outside' ? 'outside'
          : confidence === 'stale' ? 'stale'
            : confidence === 'low' ? 'low'
              : confidence === 'moderate' ? 'moderate' : 'high');
      const destLoc = destSel.loc || locations.find((l) => l.locationId === destSel.id);
      if (!destLoc) { setNotice('Destination not found.'); return; }
      const destNode = nearestNode(graph, destLoc.latitude, destLoc.longitude);
      if (!destNode || destNode.distance > 60) {
        setNotice('No published route ends near this destination. Your destination was not changed.');
        return;
      }
      const res = routeFromPosition(graph, fix.latitude, fix.longitude, destNode.node.id, 60);
      if (!res) {
        setNotice('You are too far from any recorded path to connect. Move closer to a campus path and try again.');
        return;
      }
      const geom = pathGeometry(res.graph, res);
      const pseudoRoute = {
        routeId: `gps-${Date.now()}`,
        routeName: `Verified path from your position to ${destLoc.name}`,
        points: geom,
        segments: [geom],
        waypoints: [],
        distanceMeters: Math.round(res.distance),
        hasStairs: null, hasRamp: null, isCovered: null,
        reversed: false,
        sourceLabel: 'My GPS position',
      };
      chooseRoute(pseudoRoute, 'My GPS position');
      setNotice(warning || `Route calculated from your GPS position (≈ ${formatDistance(res.distance)}). Follow the highlighted path.`);

    } catch (e) { setGpsNote(e.message || 'Could not get your position.'); }
    finally { setLocatingMe(false); }
  }

  function resetPlanning() {
    reqSeq.current++;
    stopNav();
    setRoutes(null); setSelected(null); setRouteSourceLabel(''); setRouteMsg(''); setNotice(''); setBusy(false);
  }

  async function useMyLocation() {
    setGpsNote('');
    setLocatingMe(true);
    try {
      const { fix, warning } = await captureBestPosition();
      setRawGps(fix);
      posRef.current = fix;
      const building = observeBuilding(fix);
      const confidence = gpsConfidence(fix);
      setGpsState(building?.status === 'between' ? 'ambiguous'
        : building?.status === 'outside' ? 'outside'
          : confidence === 'stale' ? 'stale'
            : confidence === 'low' ? 'low'
              : confidence === 'moderate' ? 'moderate' : 'high');
      setSheet('half');
      setGpsNote(warning || '');
      setNotice('GPS fix captured. Review the building suggestion below; nothing was set as your start automatically.');
      // A building suggestion is only a suggestion. `startSel` is never written here:
      // the user must explicitly choose it as the navigation source.
    } catch (e) { setGpsNote(e.message || 'Could not get your location. Pick a starting building manually.'); }
    finally { setLocatingMe(false); }
  }

  function confirmReroute() {
    const candidate = reroute?.candidate;
    if (!candidate) return;
    const pseudoRoute = {
      routeId: `reroute-${Date.now()}`,
      routeName: `Verified path from your position to ${destSelRef.current?.label || 'your destination'}`,
      points: candidate.points,
      segments: candidate.segments,
      waypoints: [],
      distanceMeters: Math.round(candidate.distance),
      hasStairs: null, hasRamp: null, isCovered: null,
      reversed: false,
      sourceLabel: 'My GPS position',
    };
    setRouteSourceLabel('My GPS position');
    startNav(pseudoRoute);
    setNotice('Switched to a verified path from your current GPS position. Your destination was not changed.');
  }

  async function findRoutes() {
    if (!startSel || !destSel) return;
    const seq = ++reqSeq.current;
    setRoutes(null); setSelected(null); setRouteMsg(''); setNotice(''); stopNav();
    setRouteSourceLabel(startSel.label); setBusy(true); setSheet('half');
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

  function chooseRoute(r, sourceLabel = '') {
    stopNav();
    setSelected(r);
    setRouteSourceLabel(sourceLabel || r.sourceLabel || startSel?.label || '');
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
  const upcomingWaypoints = (() => {
    if (!selected || !navInfo) return [];
    const segment = navInfo.segment ?? 0;
    const points = selected.points || [];
    return (selected.waypoints || []).map((w) => {
      const loc = locations.find((l) => l.locationId === w.locationId);
      if (!loc) return null;
      let best = Infinity;
      points.forEach((p) => {
        const d = Math.hypot(p.latitude - loc.latitude, p.longitude - loc.longitude);
        if (d < best) best = d;
      });
      const idx = points.findIndex((p) => Math.hypot(p.latitude - loc.latitude, p.longitude - loc.longitude) === best);
      return idx > segment ? { ...w, name: w.name || loc.name, idx } : null;
    }).filter(Boolean).sort((a, b) => a.idx - b.idx);
  })();
  const nextWaypoint = upcomingWaypoints.length ? upcomingWaypoints[0].name : (destSel?.label || null);

  const sortedRoutes = (routes || []).slice().sort((a, b) => (
    routeSort === 'shortest'
      ? (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.routeId - b.routeId
      : 0
  ));
  const categories = ['All', ...Array.from(new Set(locations.map(inferCategory))).sort()];
  const visible = locations.filter((l) => category === 'All' || inferCategory(l) === category);
  const detailsOpen = detailsId != null;
  // These remain separate: the suggestion describes where the device is; only the
  // user's explicit choice (`startSel`) is used as a building-to-building source.
  const sourceInfo = navigationSource(startSel, currentBuilding);
  const buildingStatus = formatBuildingStatus(currentBuilding);
  const suggestedBuilding = sourceInfo.buildingSuggestion?.buildingId
    ? locations.find((l) => String(l.locationId) === String(sourceInfo.buildingSuggestion.buildingId))
    : null;
  const suggestionIsApproximate = sourceInfo.buildingSuggestion?.status === 'approximate';
  const navSourceLabel = routeSourceLabel || startSel?.label || '—';

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
              {currentBuilding && (
                <div className="loc-card" style={{ marginTop: 8 }}>
                  <div className="loc-card-body">
                    <div className="loc-card-name" style={{ fontSize: 13 }}>{buildingStatus.current}</div>
                    {buildingStatus.reference && <div className="loc-card-desc">{buildingStatus.reference}</div>}
                    <div className="loc-card-desc">{buildingStatus.detail}</div>
                    {rawGps && <div className="loc-card-desc mono" style={{ fontSize: 11 }}>{formatFixLine(rawGps)}</div>}
                    {suggestedBuilding && String(startSel?.id) !== String(suggestedBuilding.locationId) && (
                      <button
                        type="button"
                        className="secondary"
                        style={{ marginTop: 8, width: '100%', fontSize: 12 }}
                        onClick={() => {
                          resetPlanning();
                          setStartSel(itemFor(suggestedBuilding));
                          setNotice(`Start set to ${suggestedBuilding.name}${suggestionIsApproximate ? ' (approximate suggestion)' : ''}. Change it manually if this is wrong.`);
                        }}
                      >
                        Use {suggestedBuilding.name} as start{suggestionIsApproximate ? ' (approximate)' : ''}
                      </button>
                    )}
                  </div>
                </div>
              )}
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

            {destSel && (
              <button type="button" onClick={routeFromMyLocation} style={{ width: 'auto' }} disabled={locatingMe || !graph}>
                📍 Route from my current location
              </button>
            )}
            {destSel && !graph && (
              <p className="muted" style={{ fontSize: 12 }}>Route-from-GPS needs published route data. Connect once to download it.</p>
            )}

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
                  <RouteFacts route={r} />
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
                  <RouteFacts route={selected} detailed />
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Start: {navSourceLabel} · Total route: {formatDistance(selected.distanceMeters)}
                  </div>
                  {selected.waypoints?.length > 0 && null}
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
                      <div className="nav-stat-label">Remaining on route</div>
                    </div>
                    <div className="nav-stat">
                      <div className="nav-stat-value">{navInfo ? formatDistance(navInfo.distanceFromPath) : '—'}</div>
                      <div className="nav-stat-label">From path</div>
                    </div>
                  </div>
                  <div className="nav-next" style={{ justifyContent: 'space-between' }}>
                    <span><strong>Route total</strong></span>
                    <span>{formatDistance(selected.distanceMeters)}</span>
                  </div>
                  <div className="nav-next" style={{ justifyContent: 'space-between' }}>
                    <span><strong>Start</strong></span>
                    <span>{navSourceLabel}</span>
                  </div>
                  {rawGps && (
                    <div className="nav-next" style={{ justifyContent: 'space-between' }}>
                      <span><strong>GPS accuracy</strong></span>
                      <span><span className={`gps-dot ${Number.isFinite(rawGps.accuracy) && rawGps.accuracy <= 30 ? 'good' : 'poor'}`} /> {Number.isFinite(rawGps.accuracy) ? `${Math.round(rawGps.accuracy)} m` : 'unknown'}</span>
                    </div>
                  )}
                  {rawGps && <div className="nav-next mono" style={{ fontSize: 11 }}>Device GPS: {formatFixLine(rawGps)}</div>}
                  <div className="nav-next mono" style={{ fontSize: 11 }}>GPS state: {gpsState}</div>
                  {filteredGps && <div className="nav-next mono" style={{ fontSize: 11 }}>Route fix: {formatFixLine(filteredGps)}</div>}
                  {navInfo?.projected && (
                    <div className="nav-next mono" style={{ fontSize: 11 }}>
                      Projected on route: {Number(navInfo.projected.latitude).toFixed(6)}, {Number(navInfo.projected.longitude).toFixed(6)}
                    </div>
                  )}
                  {nextWaypoint && <div className="nav-next"><span>➡</span><span>Next: <strong>{nextWaypoint}</strong></span></div>}
                  {upcomingWaypoints.length > 1 && (
                    <div className="nav-next" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <span><strong>Upcoming stops</strong></span>
                      <span style={{ fontSize: 12 }}>{upcomingWaypoints.map((w) => w.name).join(' → ')}</span>
                    </div>
                  )}
                  {navInfo?.offPath && (
                    <div className="alert warn" style={{ marginBottom: 9 }}>
                      You appear off the recorded path. Your route is unchanged; review any verified suggestion below before switching.
                    </div>
                  )}
                  {selectedHasGap && (
                    <div className="alert warn" style={{ marginBottom: 9 }}>
                      This route has a recorded GPS gap. The line is intentionally broken; use the visible landmarks and join the continuation on the map.
                    </div>
                  )}
                  {gpsNote && <div className="alert warn" style={{ marginBottom: 9 }}>{gpsNote}</div>}
                  {reroute && (
                    <div className="alert info" style={{ marginBottom: 9 }}>
                      <div>{reroute.message}</div>
                      {reroute.candidate && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ marginTop: 8, width: '100%', fontSize: 12 }}
                          onClick={confirmReroute}
                        >
                          Switch to verified path (≈ {formatDistance(reroute.candidate.distance)})
                        </button>
                      )}
                      <button type="button" className="link" style={{ marginTop: 6 }} onClick={() => setReroute(null)}>Keep current route</button>
                    </div>
                  )}
                  {!rawGps && !gpsNote && <div className="alert info">Waiting for your first GPS fix…</div>}
                  <button type="button" onClick={retryGps} disabled={locatingMe} style={{ width: 'auto', fontSize: 12, marginTop: 6 }}>
                    {locatingMe ? 'Retrying…' : 'Retry GPS'}
                  </button>
                  <div className="nav-actions">
                    <button type="button" onClick={stopNav}>Stop</button>
                    <button type="button" className={followMe ? 'secondary' : ''} onClick={() => setFollowMe((f) => !f)}>
                      {followMe ? 'Following' : 'Follow me'}
                    </button>
                    <button type="button" onClick={() => { if (posRef.current) { setFollowMe(true); setNotice('Map recentered on your GPS position.'); } }}>Recenter</button>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  {backgroundHint()} {wakeLockHint()} Routes are never switched automatically; a verified alternative requires your confirmation.
                </p>
              </>
            )}
          </div>
        )}

        {!online && <div className="alert warn">You are offline. Locations and routes saved on this device are shown; live GPS still works and no rerouting is performed.</div>}
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
          userPosition={rawGps}
          projectedPosition={navigating && navInfo?.projected ? navInfo.projected : null}
          startId={startSel?.id || null}
          destinationId={destSel?.id || null}
          followMe={followMe && navigating}
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
        {notice && <div className="alert info" style={{ margin: '10px 12px 0' }}>{notice}</div>}
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
