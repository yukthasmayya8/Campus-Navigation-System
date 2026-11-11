import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { locateOnPath } from '../lib/geo.js';

const SMVITM_CENTER = [13.3225, 74.7843]; // SMVITM, Bantakal

const dot = (color, r = 7, opacity = 1) => ({
  radius: r, color: '#fff', weight: 2.5,
  fillColor: color, fillOpacity: opacity,
});

/** Returns the nearest point on the polyline (for snapping the user dot). */
function snapPoint(pos, points) {
  if (!points || points.length < 2) return pos;
  const { segment } = locateOnPath(pos, points);
  if (segment < 0) return pos;
  const a = points[segment], b = points[segment + 1];
  if (!a || !b) return pos;
  // Project pos onto segment a→b using flat approximation
  const lat = a.latitude + 0.5 * (b.latitude - a.latitude);  // simplified midpoint snap for display
  const lng = a.longitude + 0.5 * (b.longitude - a.longitude);
  // Better: proper perpendicular foot
  const dLat = b.latitude - a.latitude, dLng = b.longitude - a.longitude;
  const len2 = dLat * dLat + dLng * dLng;
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, ((pos.latitude - a.latitude) * dLat + (pos.longitude - a.longitude) * dLng) / len2));
  return { latitude: a.latitude + t * dLat, longitude: a.longitude + t * dLng };
}

/**
 * Props:
 *   locations    – [{locationId, name, latitude, longitude, imageUrl, description}]
 *   route        – {points, waypoints} | null
 *   userPosition – {latitude, longitude} | null
 *   startId      – number | null
 *   destinationId – number | null
 *   fit          – boolean (auto-fit to route/locations)
 *   followMe     – boolean (auto-pan to user position)
 *   snapUser     – boolean (snap user dot to nearest route point)
 */
export default function CampusMap({ locations = [], route = null, userPosition = null, startId, destinationId, fit = true, followMe = false, snapUser = false }) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef({ places: null, route: null, user: null, accuracy: null });
  const userMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // ── Init map ─────────────────────────────────────────────
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false }).setView(SMVITM_CENTER, 17);

    // OSM tile layer
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);

    // Zoom control top-right
    L.control.zoom({ position: 'topright' }).addTo(m);

    layers.current.places = L.layerGroup().addTo(m);
    layers.current.route  = L.layerGroup().addTo(m);

    map.current = m;
    setMapReady(true);
    return () => { m.remove(); map.current = null; };
  }, []);

  // ── Locations layer ───────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const g = layers.current.places;
    g.clearLayers();

    locations.forEach((l) => {
      const isStart = l.locationId === startId;
      const isDest  = l.locationId === destinationId;
      const color   = isDest ? '#d93025' : isStart ? '#188038' : '#1a73e8';
      const r       = isStart || isDest ? 10 : 7;

      const marker = L.circleMarker([l.latitude, l.longitude], dot(color, r)).addTo(g);

      // Popup with building info
      const popupContent = `
        <div style="min-width:180px">
          ${l.imageUrl ? `<img src="${l.imageUrl}" style="width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:8px" onerror="this.style.display='none'">` : ''}
          <strong style="font-size:14px">${l.name}</strong>
          ${isStart ? '<span style="margin-left:6px;font-size:11px;background:#e6f4ea;color:#137333;padding:2px 6px;border-radius:9px">START</span>' : ''}
          ${isDest  ? '<span style="margin-left:6px;font-size:11px;background:#fce8e6;color:#a50e0e;padding:2px 6px;border-radius:9px">DEST</span>' : ''}
          ${l.description ? `<p style="margin:6px 0 0;font-size:12px;color:#5f6368;line-height:1.4">${l.description.slice(0, 120)}${l.description.length > 120 ? '…' : ''}</p>` : ''}
        </div>
      `;
      marker.bindPopup(popupContent, { maxWidth: 220 });
      marker.bindTooltip(l.name, { direction: 'top', offset: [0, -6] });
    });

    if (!route && locations.length) {
      const lls = locations.map((l) => [l.latitude, l.longitude]);
      try { map.current.fitBounds(L.latLngBounds(lls).pad(0.25), { maxZoom: 18 }); } catch { /* ignore */ }
    }
  }, [mapReady, locations, startId, destinationId, route]);

  // ── Route layer ───────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const g = layers.current.route;
    g.clearLayers();
    if (!route || !route.points || !route.points.length) return;

    const latlngs = route.points.map((p) => [p.latitude, p.longitude]);

    // Route line with decorator-like arrows (using polyline with dash pattern)
    const line = L.polyline(latlngs, {
      color: '#1a73e8', weight: 5, opacity: 0.9,
      lineCap: 'round', lineJoin: 'round',
    }).addTo(g);

    // Direction arrows using a dashed overlay
    L.polyline(latlngs, {
      color: 'white', weight: 2, opacity: 0.4,
      dashArray: '1 20', dashOffset: '10',
    }).addTo(g);

    // Waypoint markers
    (route.waypoints || []).forEach((w) => {
      const loc = locations.find((l) => l.locationId === w.locationId);
      if (loc) {
        L.circleMarker([loc.latitude, loc.longitude], dot('#f9ab00', 7))
          .bindTooltip(`Via: ${w.name || loc.name}`, { direction: 'top', offset: [0, -6] })
          .addTo(g);
      }
    });

    if (fit) {
      try { map.current.fitBounds(line.getBounds().pad(0.25), { maxZoom: 18 }); } catch { /* ignore */ }
    }
  }, [mapReady, route, locations, fit]);

  // ── User position (with snap-to-path and accuracy circle) ─
  useEffect(() => {
    if (!mapReady || !map.current) return;

    // Remove previous
    if (userMarker.current)   { userMarker.current.remove();   userMarker.current   = null; }
    if (accuracyCircle.current) { accuracyCircle.current.remove(); accuracyCircle.current = null; }

    if (!userPosition) return;

    const displayPos = snapUser && route?.points?.length >= 2
      ? snapPoint(userPosition, route.points)
      : userPosition;

    const ll = [displayPos.latitude, displayPos.longitude];

    // Pulsing user dot (outer ring + inner dot)
    accuracyCircle.current = L.circle(ll, {
      radius: userPosition.accuracy || 15,
      color: '#1a73e8', fillColor: '#1a73e8', fillOpacity: 0.1, weight: 1,
    }).addTo(map.current);

    userMarker.current = L.circleMarker(ll, {
      radius: 10, color: '#fff', weight: 3,
      fillColor: '#1a73e8', fillOpacity: 1,
      className: 'user-dot-marker',
    }).bindTooltip('You are here', { permanent: false }).addTo(map.current);

    if (followMe) {
      map.current.setView(ll, Math.max(map.current.getZoom(), 18), { animate: true, duration: 0.5 });
    }
  }, [mapReady, userPosition, route, snapUser, followMe]);

  return (
    <div ref={el} className="map" role="application" aria-label="Campus navigation map" />
  );
}
