import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { locateOnPath, splitAtTimeGaps, haversine } from '../lib/geo.js';

export const TILE_URLS = {
  standard: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};
export const TILE_ATTRIBUTIONS = {
  standard: '© OpenStreetMap contributors',
  satellite: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
};
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
 *   mapType: 'standard' | 'satellite' (controlled), onMapTypeChange
 */
export default function MapView({
  locations = [], route = null, userPosition = null, startId, destinationId,
  fit = true, followMe = false, snapUser = false, onSelectLocation, height, className = '',
  mapType: mapTypeProp, onMapTypeChange,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const baseLayer = useRef(null);
  const layers = useRef({ places: null, route: null });
  const userMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const selectRef = useRef(onSelectLocation);
  selectRef.current = onSelectLocation;
  const [ready, setReady] = useState(false);
  const [mapType, setMapType] = useState(mapTypeProp || 'standard');
  const fitted = useRef('');

  // Sync controlled prop
  useEffect(() => { if (mapTypeProp && mapTypeProp !== mapType) setMapType(mapTypeProp); }, [mapTypeProp]);

  useEffect(() => {
    if (!el.current) return undefined;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(DEFAULT_CENTER, 17);
    baseLayer.current = L.tileLayer(TILE_URLS[mapType], { maxZoom: 20, attribution: TILE_ATTRIBUTIONS[mapType] }).addTo(m);
    L.control.zoom({ position: 'topright' }).addTo(m);
    layers.current.places = L.layerGroup().addTo(m);
    layers.current.route = L.layerGroup().addTo(m);
    map.current = m;
    setReady(true);
    return () => { m.remove(); map.current = null; baseLayer.current = null; layers.current = { places: null, route: null }; };
  }, []);

  // Swap basemap when type changes
  useEffect(() => {
    if (!ready || !map.current || !baseLayer.current) return;
    map.current.removeLayer(baseLayer.current);
    baseLayer.current = L.tileLayer(TILE_URLS[mapType], { maxZoom: 20, attribution: TILE_ATTRIBUTIONS[mapType] }).addTo(map.current);
    baseLayer.current.bringToBack();
  }, [mapType, ready]);

  const handleMapTypeChange = (t) => {
    setMapType(t);
    if (onMapTypeChange) onMapTypeChange(t);
  };

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
    if (parts.length > 1) {
      parts.slice(0, -1).forEach((part) => {
        const end = part[part.length - 1];
        if (end) L.circleMarker([end.latitude, end.longitude], dot('#f9ab00', 6)).bindTooltip('GPS gap', { direction: 'top' }).addTo(g);
      });
    }

    (route?.waypoints || []).forEach((w) => {
      const loc = locations.find((l) => l.locationId === w.locationId);
      if (loc) L.circleMarker([loc.latitude, loc.longitude], { radius: 8, color: '#fff', weight: 2, fillColor: '#9334e6', fillOpacity: 1 }).bindTooltip(w.name || loc.name, { direction: 'top' }).addTo(g);
    });

    if (userPosition) {
      const p = snapUser ? snapPoint(userPosition, route?.points || []) : userPosition;
      if (!userMarker.current) {
        userMarker.current = L.circleMarker([p.latitude, p.longitude], { radius: 9, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map.current);
      } else {
        userMarker.current.setLatLng([p.latitude, p.longitude]);
      }
      if (accuracyCircle.current) map.current.removeLayer(accuracyCircle.current);
      if (userPosition.accuracy) {
        accuracyCircle.current = L.circle([p.latitude, p.longitude], { radius: userPosition.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.08 }).addTo(map.current);
      }
    }

    if (route && fit && parts.length) {
      const all = parts.flat();
      try { map.current.fitBounds(L.latLngBounds(all.map((p) => [p.latitude, p.longitude])).pad(0.2), { maxZoom: 18 }); } catch { /* ignore */ }
    }
  }, [ready, route, userPosition, fit, snapUser, locations]);

  // Map type selector (top-left)
  return (
    <div className={`map ${className}`} style={height ? { height } : undefined}>
      <div ref={el} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 500, display: 'flex', gap: 4, background: 'rgba(255,255,255,0.9)', borderRadius: 8, padding: 3, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
        <button type="button" onClick={() => handleMapTypeChange('standard')} style={{ padding: '4px 10px', fontSize: 12, minHeight: 28, border: 'none', borderRadius: 6, background: mapType === 'standard' ? '#1a73e8' : 'transparent', color: mapType === 'standard' ? '#fff' : '#333', cursor: 'pointer' }}>Map</button>
        <button type="button" onClick={() => handleMapTypeChange('satellite')} style={{ padding: '4px 10px', fontSize: 12, minHeight: 28, border: 'none', borderRadius: 6, background: mapType === 'satellite' ? '#1a73e8' : 'transparent', color: mapType === 'satellite' ? '#fff' : '#333', cursor: 'pointer' }}>Satellite</button>
      </div>
    </div>
  );
}