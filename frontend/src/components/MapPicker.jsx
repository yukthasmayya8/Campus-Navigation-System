import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TILE_URL, TILE_ATTRIBUTION, DEFAULT_CENTER } from "./mapConfig";
import { styles } from "./ui";

const pin = () => L.divIcon({ className: "", html: `<div class="${styles.pin}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });

// Map with ONE draggable marker. value = { lat, lng } | null. Drag the marker or tap the map to correct the position.
export default function MapPicker({ value, onChange, others = [], height = 280 }) {
  const el = useRef(null), map = useRef(null), marker = useRef(null), cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const first = others[0];
    const m = L.map(el.current).setView(value ? [value.lat, value.lng] : first ? [first.latitude, first.longitude] : DEFAULT_CENTER, 18);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(m);
    m.on("click", (e) => cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => { m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map.current) return undefined;
    const g = L.layerGroup().addTo(map.current);
    others.forEach((o) => L.circleMarker([o.latitude, o.longitude], { radius: 5, color: "#fff", weight: 1, fillColor: o.status === "inactive" ? "#c9ced4" : "#8a94a0", fillOpacity: 1 }).bindTooltip(o.name).addTo(g));
    return () => g.remove();
  }, [others]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    if (!value) { if (marker.current) { marker.current.remove(); marker.current = null; } return; }
    const ll = [value.lat, value.lng];
    if (!marker.current) {
      marker.current = L.marker(ll, { draggable: true, icon: pin(), keyboard: true, title: "Drag to correct the position" }).addTo(m);
      marker.current.on("dragend", () => { const p = marker.current.getLatLng(); cb.current({ lat: p.lat, lng: p.lng }); });
      m.panTo(ll);
    } else marker.current.setLatLng(ll);
  }, [value && value.lat, value && value.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={styles.map} style={{ height }} role="application" aria-label="Map. Drag the marker or tap to correct the position." />;
}
