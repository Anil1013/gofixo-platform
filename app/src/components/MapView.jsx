import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Emoji pins (avoids Leaflet's default marker image paths, which break under bundlers)
function pinIcon(emoji, color) {
  return L.divIcon({
    className: 'map-pin',
    html: `<div class="map-pin-inner" style="background:${color}">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// markers: [{ lat, lng, emoji, color }]   line: [[lat, lng], ...]
export default function MapView({ markers = [], line = null, height = 200 }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const groupRef = useRef(null);

  useEffect(() => {
    const map = L.map(el.current, { zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    map.setView([28.4595, 77.0266], 12); // Gurugram until markers arrive
    groupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const points = [];
    markers.forEach((m) => {
      L.marker([m.lat, m.lng], { icon: pinIcon(m.emoji, m.color) }).addTo(group);
      points.push([m.lat, m.lng]);
    });
    if (line && line.length > 1) {
      L.polyline(line, { color: '#8B5CF6', weight: 5, opacity: 0.85 }).addTo(group);
      line.forEach((p) => points.push(p));
    }
    if (points.length === 1) map.setView(points[0], 16);
    else if (points.length > 1) map.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
  }, [JSON.stringify(markers), line]);

  return <div ref={el} className="map-box" style={{ height }} />;
}
