import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Emoji pins (avoids Leaflet's default marker image paths, which break under bundlers)
function pinIcon(emoji, color) {
  return L.divIcon({
    className: 'map-pin',
    html: `<div class="map-pin-inner" style="background:${color || '#14B8A6'}">${emoji || '📍'}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function validPoint(point) {
  return Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]));
}

function normalizeLine(line) {
  if (!Array.isArray(line)) return [];
  return line
    .map((point) => {
      if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
      if (point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng))) {
        return [Number(point.lat), Number(point.lng)];
      }
      return null;
    })
    .filter(validPoint);
}

// markers: [{ lat, lng, emoji, color }]   line: [[lat, lng], ...]
export default function MapView({ markers = [], line = null, height = 200, draggableMarkers = false, onMarkerDragEnd = null }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const groupRef = useRef(null);

  useEffect(() => {
    if (!el.current) return undefined;

    let map;
    try {
      map = L.map(el.current, { zoomControl: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      map.setView([28.4595, 77.0266], 12); // Gurugram until markers arrive
      groupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      window.setTimeout(() => {
        try { map.invalidateSize(); } catch { /* map may already be removed */ }
      }, 150);
    } catch {
      mapRef.current = null;
      groupRef.current = null;
      return undefined;
    }

    return () => {
      try { map.remove(); } catch { /* ignore Leaflet cleanup errors */ }
      mapRef.current = null;
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;

    try {
      group.clearLayers();
      const points = [];

      (Array.isArray(markers) ? markers : []).forEach((m) => {
        const lat = Number(m?.lat);
        const lng = Number(m?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const marker = L.marker([lat, lng], {
          icon: pinIcon(m?.emoji, m?.color),
          draggable: draggableMarkers,
        }).addTo(group);

        if (draggableMarkers && onMarkerDragEnd && m.id) {
          marker.on('dragend', () => {
            const p = marker.getLatLng();
            onMarkerDragEnd(m.id, { lat: p.lat, lng: p.lng });
          });
        }
        points.push([lat, lng]);
      });

      const safeLine = normalizeLine(line);
      if (safeLine.length > 1) {
        L.polyline(safeLine, { color: '#8B5CF6', weight: 5, opacity: 0.85 }).addTo(group);
        safeLine.forEach((p) => points.push(p));
      }

      if (points.length === 1) map.setView(points[0], 16);
      else if (points.length > 1) map.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
      map.invalidateSize();
    } catch {
      // A bad route payload must never blank the whole booking screen.
      try { group.clearLayers(); } catch { /* ignore cleanup errors */ }
    }
  }, [JSON.stringify(markers), JSON.stringify(line), draggableMarkers, onMarkerDragEnd]);

  return <div ref={el} className="map-box" style={{ height }} />;
}
