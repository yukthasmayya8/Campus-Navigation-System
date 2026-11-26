import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { locateOnPath, splitAtTimeGaps } from '../lib/geo.js';

export const TILE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_TILE_URL) || 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
export const DEFAULT_CENTER = [13.3225, 74.7843]; // SMVITM, Bantakal

const dot = (color, r = 7) => ({ radius: r, color: '#fff', weight: 2.5, fillColor: color, fillOpacity: 1 });

/** Projection of `pos` onto the segment nearest to it (display only). */
function snapPoint(pos, points) {
  if (!points || points.length < 2) return pos;
  const { segment } = locateOnPath(pos, points);
  const a = points[segment], b = points[segment + 1];
  if (!a || !b) return pos;
  const dLat = b.latitude - a.latitude, dLng = b.longitude - a.longitude;
  const len2 = dLat * dLat + dLng * dLng;
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, ((pos.latitude - a.latitude) * dLat + (pos.longitude - a.longitude) * dLng) / len2));
  return { latitude: a.latitude + t * dLat, longitude: a.longitude + t * dLng };
}

/** Route lines, split wherever the recorder marked a signal gap. */
function routeParts(route) {
  if (!route) return [];
  if (Array.isArray(route.segments) && route.segments.length) return route.segments.filter((s) => s.length);
  return splitAtTimeGaps(Array.isArray(route.points) ? route.points : []);
}

/**
 * Interactive campus map.
 *
 * Props:
 *   locations, route ({points,segments,waypoints}), userPosition, startId, destinationId
 *   fit (bool), followMe (bool), snapUser (bool), onSelectLocation(location), height, className
 */
export default function MapView({
  locations = [], route = null, userPosition = null, startId, destinationId,
  fit = true, followMe = false, snapUser = false, onSelectLocation, height, className = '',
}) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef({ places: null, route: null });
  const userMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const selectRef = useRef(onSelectLocation);
  selectRef.current = onSelectLocation;
  const [ready, setReady] = useState(false);
  const fitted = useRef('');

  useEffect(() => {
    if (!el.current) return undefined;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(DEFAULT_CENTER, 17);
    L.tileLayer(TILE_URL, { maxZoom: 20, attribution: TILE_ATTRIBUTION }).addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    layers.current.places = L.layerGroup().addTo(m);
    layers.current.route = L.layerGroup().addTo(m);
    map.current = m;
    setReady(true);
    return () => { m.remove(); map.current = null; layers.current = { places: null, route: null }; };
  }, []);

  /* Places */
  useEffect(() => {
    if (!ready || !map.current) return;
    const g = layers.current.places;
    g.clearLayers();

    locations.forEach((l) => {
      const isStart = l.locationId === startId;
      const isDest = l.locationId === destinationId;
      const color = isDest ? '#d93025' : isStart ? '#188038' : '#1a73e8';
      const marker = L.circleMarker([l.latitude, l.longitude], dot(color, isStart || isDest ? 10 : 7)).addTo(g);
      marker.bindTooltip(l.name, { direction: 'top', offset: [0, -6] });
      if (selectRef.current) {
        marker.on('click', () => selectRef.current(l));
        marker.getElement()?.setAttribute('role', 'button');
      }
    });

    if (!route && locations.length) {
      const key = `places:${locations.map((l) => l.locationId).join(',')}`;
      if (fitted.current !== key) {
        fitted.current = key;
        try { map.current.fitBounds(L.latLngBounds(locations.map((l) => [l.latitude, l.longitude])).pad(0.25), { maxZoom: 18 }); } catch { /* ignore */ }
      }
    }
  }, [ready, locations, startId, destinationId, route]);

  /* Route + waypoints */
  useEffect(() => {
    if (!ready || !map.current) return;
    const g = layers.current.route;
    g.clearLayers();

    const parts = routeParts(route);
    parts.forEach((part) => {
      if (part.length < 2) return;
      const latlngs = part.map((p) => [p.latitude, p.longitude]);
      L.polyline(latlngs, { color: '#0d47a1', weight: 9, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }).addTo(g);
      L.polyline(latlngs, { color: '#1a73e8', weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(g);
      L.polyline(latlngs, { color: '#fff', weight: 2, opacity: 0.5, dashArray: '1 14', dashOffset: '7' }).addTo(g);
    });
    // Explicit gap markers keep an interruption visible instead of implying a line was walked.
    if (parts.length > 1) {
      parts.slice(0, -1).forEach((part) => {
        const end = part[part.length - 1];
        if (end) L.circleMarker([end.latitude, end.longitude], dot('#f9ab00', 6)).bindTooltip('GPS gap', { direction: 'top' }).addTo(g);
      });
      parts.slice(1).forEach((part) => {
        const start = part[0];
        if (start && part.length < 2) {
          L.circleMarker([start.latitude, start.longitude], { radius: 5, color: '#f9ab00', weight: 2, fillOpacity: 0 })
            .bindTooltip('GPS gap — isolated fix', { direction: 'top' }).addTo(g);
        }
      });
    }

    (route?.waypoints || []).forEach((w) => {
      const loc = w.locationId ? locations.find((l) => l.locationId === w.locationId) : null;
      const p = loc || (w.latitude != null ? w : null);
      if (p) L.circleMarker([p.latitude, p.longitude], dot('#f9ab00', 7)).bindTooltip(`Via: ${w.name || loc?.name || 'stop'}`, { direction: 'top', offset: [0, -6] }).addTo(g);
    });

    if (fit && parts.length) {
      const key = `route:${route.routeId || route.id || ''}:${parts.reduce((n, p) => n + p.length, 0)}`;
      if (fitted.current !== key) {
        fitted.current = key;
        try { map.current.fitBounds(L.latLngBounds(parts.flat().map((p) => [p.latitude, p.longitude])).pad(0.22), { maxZoom: 18 }); } catch { /* ignore */ }
      }
    }
  }, [ready, route, locations, fit]);

  /* User position */
  useEffect(() => {
    if (!ready || !map.current) return;
    userMarker.current?.remove(); userMarker.current = null;
    accuracyCircle.current?.remove(); accuracyCircle.current = null;
    if (!userPosition) return;

    const shown = snapUser && route?.points?.length >= 2 ? snapPoint(userPosition, route.points) : userPosition;
    const ll = [shown.latitude, shown.longitude];
    accuracyCircle.current = L.circle(ll, {
      radius: Math.min(userPosition.accuracy || 15, 120),
      color: '#1a73e8', fillColor: '#1a73e8', fillOpacity: 0.1, weight: 1,
    }).addTo(map.current);
    userMarker.current = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 })
      .bindTooltip('You are here').addTo(map.current);
    if (followMe) map.current.setView(ll, Math.max(map.current.getZoom(), 18), { animate: true });
  }, [ready, userPosition, route, snapUser, followMe]);

  return <div ref={el} className={`map ${className}`} style={height ? { height } : undefined} role="application" aria-label="Campus navigation map" />;
}

/**
 * Admin coordinate picker: one draggable marker. Tap the map or drag the pin.
 * value = {lat,lng} | null; others = [{latitude,longitude,name,status}]
 */
export function LocationPicker({ value, onChange, others = [], height = 240 }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!el.current) return undefined;
    const first = others[0];
    const m = L.map(el.current).setView(
      value ? [value.lat, value.lng] : first ? [first.latitude, first.longitude] : DEFAULT_CENTER, 18,
    );
    L.tileLayer(TILE_URL, { maxZoom: 20, attribution: TILE_ATTRIBUTION }).addTo(m);
    m.on('click', (e) => cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => { m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current) return undefined;
    const g = L.layerGroup().addTo(map.current);
    others.forEach((o) => L.circleMarker([o.latitude, o.longitude], {
      radius: 5, color: '#fff', weight: 1,
      fillColor: o.status === 'inactive' ? '#c9ced4' : '#8a94a0', fillOpacity: 1,
    }).bindTooltip(o.name).addTo(g));
    return () => { g.remove(); };
  }, [others]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove(); marker.current = null;
      return;
    }
    const ll = [value.lat, value.lng];
    if (!marker.current) {
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>',
        iconSize: [18, 18], iconAnchor: [9, 9],
      });
      marker.current = L.marker(ll, { draggable: true, icon, keyboard: true, title: 'Drag to correct the position' }).addTo(m);
      marker.current.on('dragend', () => { const p = marker.current.getLatLng(); cb.current({ lat: p.lat, lng: p.lng }); });
      m.panTo(ll);
    } else marker.current.setLatLng(ll);
  }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="map" style={{ height, borderRadius: 12 }} role="application" aria-label="Map. Drag the marker or tap to correct the position." />;
}
