import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { splitAtTimeGaps } from '../lib/geo.js';

export const TILE_URLS = {
  standard: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};
export const TILE_ATTRIBUTIONS = {
  standard: '© OpenStreetMap contributors',
  satellite: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
};
export const DEFAULT_CENTER = [13.3225, 74.7843]; // SMVITM, Bantakal
// Approximate georeferenced bounds for the supplied campus drone image.
export const DRONE_BOUNDS = [[13.25375, 74.78348], [13.25595, 74.78702]];

const dot = (color, r = 7) => ({ radius: r, color: '#fff', weight: 2.5, fillColor: color, fillOpacity: 1 });

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
 *   fit (bool), followMe (bool), projectedPosition (navigation-only route projection), onSelectLocation(location), height, className
 *   mapType: 'standard' | 'satellite' (controlled), onMapTypeChange
 */
export default function MapView({
  locations = [], route = null, userPosition = null, projectedPosition = null, startId, destinationId,
  fit = true, followMe = false, onSelectLocation, height, className = '',
  mapType: mapTypeProp, onMapTypeChange,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const baseLayer = useRef(null);
  const droneOverlay = useRef(null);
  const layers = useRef({ places: null, route: null });
  const userMarker = useRef(null);
  const accuracyCircle = useRef(null);
  const projectedMarker = useRef(null);
  const fittedRoute = useRef('');
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
    return () => {
      m.remove();
      if (droneOverlay.current) { try { droneOverlay.current.remove(); } catch { /* ignore */ } droneOverlay.current = null; }
      map.current = null; baseLayer.current = null;
      layers.current = { places: null, route: null };
      userMarker.current = null; accuracyCircle.current = null; projectedMarker.current = null;
    };
  }, []);

  // Swap basemap when type changes
  useEffect(() => {
    if (!ready || !map.current) return;
    if (droneOverlay.current) { map.current.removeLayer(droneOverlay.current); droneOverlay.current = null; }
    if (baseLayer.current) { map.current.removeLayer(baseLayer.current); baseLayer.current = null; }
    if (mapType === 'drone') {
      droneOverlay.current = L.imageOverlay('/campus-drone.jpg', DRONE_BOUNDS, { opacity: 0.92, interactive: false }).addTo(map.current);
      droneOverlay.current.bringToBack();
    } else {
      baseLayer.current = L.tileLayer(TILE_URLS[mapType], { maxZoom: 20, attribution: TILE_ATTRIBUTIONS[mapType] }).addTo(map.current);
      baseLayer.current.bringToBack();
    }
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

  /* Route + waypoints. Fit only when the route changes, never on every GPS fix. */
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

    const routeKey = route ? `${route.routeId}:${(route.points || []).length}:${parts.length}` : '';
    if (route && fit && parts.length && fittedRoute.current !== routeKey) {
      fittedRoute.current = routeKey;
      const all = parts.flat();
      try { map.current.fitBounds(L.latLngBounds(all.map((p) => [p.latitude, p.longitude])).pad(0.2), { maxZoom: 18 }); } catch { /* ignore */ }
    }
    if (!route) fittedRoute.current = '';
  }, [ready, route, fit, locations]);

  /* Device GPS marker: always the actual fix, never a building coordinate or snapped point. */
  useEffect(() => {
    if (!ready || !map.current) return;
    if (!userPosition || !Number.isFinite(userPosition.latitude) || !Number.isFinite(userPosition.longitude)) {
      if (userMarker.current) { map.current.removeLayer(userMarker.current); userMarker.current = null; }
      if (accuracyCircle.current) { map.current.removeLayer(accuracyCircle.current); accuracyCircle.current = null; }
      return;
    }
    const { latitude, longitude } = userPosition;
    if (!userMarker.current) {
      userMarker.current = L.circleMarker([latitude, longitude], { radius: 9, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 })
        .bindTooltip('Your GPS position', { direction: 'top', offset: [0, -8] }).addTo(map.current);
    } else {
      userMarker.current.setLatLng([latitude, longitude]);
    }
    if (accuracyCircle.current) map.current.removeLayer(accuracyCircle.current);
    if (Number.isFinite(userPosition.accuracy) && userPosition.accuracy > 0) {
      accuracyCircle.current = L.circle([latitude, longitude], {
        radius: userPosition.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.08,
      }).addTo(map.current);
    }
  }, [ready, userPosition]);

  /* Optional, visually distinct projection on the route (navigation state only). */
  useEffect(() => {
    if (!ready || !map.current) return;
    if (!projectedPosition || !Number.isFinite(projectedPosition.latitude)) {
      if (projectedMarker.current) { map.current.removeLayer(projectedMarker.current); projectedMarker.current = null; }
      return;
    }
    const ll = [projectedPosition.latitude, projectedPosition.longitude];
    if (!projectedMarker.current) {
      projectedMarker.current = L.circleMarker(ll, { radius: 6, color: '#1a73e8', weight: 2, fillColor: '#fff', fillOpacity: 0.9, dashArray: '3 3' })
        .bindTooltip('Projected onto route', { direction: 'top' }).addTo(map.current);
    } else projectedMarker.current.setLatLng(ll);
  }, [ready, projectedPosition]);

  // Map type selector (top-left)
  return (
    <div className={`map ${className}`} style={height ? { height } : undefined}>
      <div ref={el} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 500, display: 'flex', gap: 4, background: 'rgba(255,255,255,0.9)', borderRadius: 8, padding: 3, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
        <button type="button" onClick={() => handleMapTypeChange('standard')} style={{ padding: '4px 10px', fontSize: 12, minHeight: 28, border: 'none', borderRadius: 6, background: mapType === 'standard' ? '#1a73e8' : 'transparent', color: mapType === 'standard' ? '#fff' : '#333', cursor: 'pointer' }}>Map</button>
        <button type="button" onClick={() => handleMapTypeChange('satellite')} style={{ padding: '4px 10px', fontSize: 12, minHeight: 28, border: 'none', borderRadius: 6, background: mapType === 'satellite' ? '#1a73e8' : 'transparent', color: mapType === 'satellite' ? '#fff' : '#333', cursor: 'pointer' }}>Satellite</button>
        <button type="button" onClick={() => handleMapTypeChange('drone')} style={{ padding: '4px 10px', fontSize: 12, minHeight: 28, border: 'none', borderRadius: 6, background: mapType === 'drone' ? '#1a73e8' : 'transparent', color: mapType === 'drone' ? '#fff' : '#333', cursor: 'pointer' }}>Drone</button>
      </div>
    </div>
  );
}
export function LocationPicker({ value, onChange, others = [], accuracyM = null, height = 230 }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const accuracyCircle = useRef(null);
  const othersLayer = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!el.current) return undefined;
    const center = value ? [value.lat, value.lng] : DEFAULT_CENTER;
    const m = L.map(el.current, { zoomControl: true, attributionControl: false }).setView(center, 17);
    L.tileLayer(TILE_URLS.standard, { maxZoom: 20 }).addTo(m);
    othersLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    setReady(true);
    m.on('click', (e) => {
      const { lat, lng } = e.latlng;
      if (marker.current) marker.current.setLatLng([lat, lng]);
      else {
        marker.current = L.marker([lat, lng], { draggable: true }).addTo(m);
        marker.current.on('dragend', () => {
          const p = marker.current.getLatLng();
          onChange?.({ lat: p.lat, lng: p.lng });
        });
      }
      onChange?.({ lat, lng });
    });
    return () => { m.remove(); map.current = null; marker.current = null; accuracyCircle.current = null; othersLayer.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !map.current || !othersLayer.current) return;
    othersLayer.current.clearLayers();
    (others || []).forEach((l) => {
      L.circleMarker([l.latitude, l.longitude], { radius: 5, color: '#999', weight: 1, fillOpacity: 0.5 }).addTo(othersLayer.current);
    });
  }, [ready, others]);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (!value) {
      if (marker.current) { map.current.removeLayer(marker.current); marker.current = null; }
      if (accuracyCircle.current) { map.current.removeLayer(accuracyCircle.current); accuracyCircle.current = null; }
      return;
    }
    const ll = [value.lat, value.lng];
    if (!marker.current) {
      marker.current = L.marker(ll, { draggable: true }).addTo(map.current);
      marker.current.on('dragend', () => {
        const p = marker.current.getLatLng();
        onChange?.({ lat: p.lat, lng: p.lng });
      });
    } else marker.current.setLatLng(ll);
    if (accuracyCircle.current) map.current.removeLayer(accuracyCircle.current);
    if (Number.isFinite(accuracyM) && accuracyM > 0) {
      accuracyCircle.current = L.circle(ll, { radius: accuracyM, color: '#1a73e8', weight: 1, fillOpacity: 0.1 })
        .bindTooltip(`GPS ±${Math.round(accuracyM)} m`).addTo(map.current);
    }
    // Keep the pin centred when a fresh GPS capture replaces the previous coordinate.
    map.current.panTo(ll);
  }, [ready, value, accuracyM, onChange]);

  return <div ref={el} style={{ width: '100%', height, borderRadius: 12, overflow: 'hidden' }} />;
}