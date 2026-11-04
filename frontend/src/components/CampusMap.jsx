import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const CENTER = [13.3409, 74.7421]; // fallback only; the map fits to data when available
const dot = (color, r = 7) => ({ radius: r, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });

/**
 * Props: locations (markers), route (selected alternative: points + waypoints),
 * userPosition ({latitude, longitude} | null), startId, destinationId.
 */
export default function CampusMap({ locations = [], route = null, userPosition = null, startId, destinationId, fit = true }) {
  const el = useRef(null); const map = useRef(null);
  const layers = useRef({ places: null, route: null, user: null });

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: true }).setView(CENTER, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map.current);
    layers.current.places = L.layerGroup().addTo(map.current);
    layers.current.route = L.layerGroup().addTo(map.current);
    return () => { map.current.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const g = layers.current.places; if (!g) return;
    g.clearLayers();
    locations.forEach((l) => {
      const color = l.locationId === destinationId ? '#d93025' : l.locationId === startId ? '#188038' : '#5f6368';
      L.circleMarker([l.latitude, l.longitude], dot(color, 8)).bindTooltip(l.name).addTo(g);
    });
    if (!route && locations.length) map.current.fitBounds(L.latLngBounds(locations.map((l) => [l.latitude, l.longitude])).pad(0.2), { maxZoom: 18 });
  }, [locations, startId, destinationId, route]);

  useEffect(() => {
    const g = layers.current.route; if (!g) return;
    g.clearLayers();
    if (!route || !route.points.length) return;
    const latlngs = route.points.map((p) => [p.latitude, p.longitude]);
    const line = L.polyline(latlngs, { color: '#1a73e8', weight: 5, opacity: 0.85 }).addTo(g);
    route.waypoints.forEach((w) => {
      const loc = locations.find((l) => l.locationId === w.locationId);
      if (loc) L.circleMarker([loc.latitude, loc.longitude], dot('#f9ab00', 6)).bindTooltip(w.name).addTo(g);
    });
    if (fit) map.current.fitBounds(line.getBounds().pad(0.2));
  }, [route, locations, fit]);

  useEffect(() => {
    if (layers.current.user) { layers.current.user.remove(); layers.current.user = null; }
    if (userPosition && map.current)
      layers.current.user = L.circleMarker([userPosition.latitude, userPosition.longitude], dot('#1a73e8', 9)).bindTooltip('You are here').addTo(map.current);
  }, [userPosition]);

  return <div ref={el} className="map" role="application" aria-label="Campus map" />;
}
