import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TILE_URL, TILE_ATTRIBUTION, DEFAULT_CENTER } from "./mapConfig";
import { styles } from "./ui";

const dot = (ll, color, r) => L.circleMarker(ll, { radius: r, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 });
// Shows the recorded path with the start (green), destination (dark) and ordered waypoints (grey).
export default function RoutePreview({ locations, sourceId, destinationId, waypointIds = [], points = [], height = 280 }) {
  const el = useRef(null), map = useRef(null), layer = useRef(null), line = useRef(null), fitted = useRef(false);
  useEffect(() => {
    const m = L.map(el.current).setView(DEFAULT_CENTER, 18);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(m);
    layer.current = L.layerGroup().addTo(m); line.current = L.polyline([], { color: "#1d5fd1", weight: 5 }).addTo(m); map.current = m;
    return () => { m.remove(); map.current = null; fitted.current = false; };
  }, []);
  useEffect(() => {
    const m = map.current; if (!m) return;
    const by = (id) => locations.find((l) => l.id === Number(id));
    layer.current.clearLayers();
    line.current.setLatLngs(points.map((p) => [p.latitude, p.longitude]));
    const mark = (l, color, r, permanent) => { if (l) dot([l.latitude, l.longitude], color, r).bindTooltip(l.name, { permanent, direction: "top" }).addTo(layer.current); };
    mark(by(sourceId), "#1b7a43", 9, true); mark(by(destinationId), "#1a1d21", 9, true);
    waypointIds.forEach((id) => mark(by(id), "#8a94a0", 7, false));
    if (!fitted.current && points.length > 1) { m.fitBounds(line.current.getBounds().pad(0.3)); fitted.current = true; }
    else if (!fitted.current && by(sourceId)) m.setView([by(sourceId).latitude, by(sourceId).longitude], 18);
  }, [locations, sourceId, destinationId, waypointIds, points]);
  return <div ref={el} className={styles.map} style={{ height }} role="img" aria-label="Preview of the recorded path" />;
}
