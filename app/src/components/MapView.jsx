import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function pinIcon(emoji, color) {
  return L.divIcon({
    className: 'map-pin',
    html: `<div class="map-pin-inner" style="background:${color || '#14B8A6'}">${emoji || '📍'}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function validPoint(point) {
  return Array.isArray(point) && point.length >= 2
    && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
}

function normalizeLine(line) {
  if (!Array.isArray(line)) return [];
  return line.map((point) => {
    if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
    if (point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng))) {
      return [Number(point.lat), Number(point.lng)];
    }
    return null;
  }).filter(validPoint);
}

let googleMapsPromise;
function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gofixo-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google.maps), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Maps JavaScript API failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.gofixoGoogleMaps = 'true';
    script.async = true;
    script.defer = true;
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&v=weekly';
    script.onload = () => window.google?.maps
      ? resolve(window.google.maps)
      : reject(new Error('Google Maps JavaScript API is unavailable'));
    script.onerror = () => reject(new Error('Google Maps JavaScript API failed to load'));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

// Uses Google Maps JavaScript API when VITE_GOOGLE_MAPS_API_KEY is configured.
// Leaflet remains a safe visual fallback; route geometry and ETA still come from Google Routes API.
export default function MapView({ markers = [], line = null, height = 200, draggableMarkers = false, onMarkerDragEnd = null }) {
  const [mapReady, setMapReady] = useState(0);
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const fittedRef = useRef('');
  const googleModeRef = useRef(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  useEffect(() => {
    if (!el.current) return undefined;
    let cancelled = false;
    let leafletMap = null;
    let leafletGroup = null;

    const renderLeaflet = () => {
      if (cancelled || !el.current) return;
      try {
        leafletMap = L.map(el.current, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        }).addTo(leafletMap);
        leafletMap.setView([28.4595, 77.0266], 12);
        leafletGroup = L.layerGroup().addTo(leafletMap);
        mapRef.current = leafletMap;
        layerRef.current = leafletGroup;
        googleModeRef.current = false;
        setMapReady((value) => value + 1);
        window.setTimeout(() => { if (!cancelled) leafletMap?.invalidateSize(); }, 150);
      } catch {
        mapRef.current = null;
        layerRef.current = null;
      }
    };

    if (apiKey) {
      loadGoogleMaps(apiKey).then((maps) => {
        if (cancelled || !el.current) return;
        const map = new maps.Map(el.current, {
          center: { lat: 28.4595, lng: 77.0266 },
          zoom: 12,
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        });
        mapRef.current = map;
        layerRef.current = { maps, overlays: [] };
        googleModeRef.current = true;
        setMapReady((value) => value + 1);
      }).catch(() => renderLeaflet());
    } else {
      renderLeaflet();
    }

    return () => {
      cancelled = true;
      if (googleModeRef.current && layerRef.current?.overlays) {
        layerRef.current.overlays.forEach((overlay) => overlay.setMap(null));
      }
      try { leafletMap?.remove(); } catch { /* ignore cleanup */ }
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const safeMarkers = (Array.isArray(markers) ? markers : []).map((m) => ({
      ...m, lat: Number(m?.lat), lng: Number(m?.lng),
    })).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
    const safeLine = normalizeLine(line);
    const signature = JSON.stringify({ markers: safeMarkers.map((m) => [m.lat, m.lng]), line: safeLine });

    try {
      if (googleModeRef.current && layer.maps) {
        layer.overlays.forEach((overlay) => overlay.setMap(null));
        layer.overlays = [];
        const points = [];
        safeMarkers.forEach((m) => {
          const marker = new layer.maps.Marker({
            map, position: { lat: m.lat, lng: m.lng },
            title: m.title || m.emoji || 'Gofixo location',
            draggable: draggableMarkers,
          });
          if (draggableMarkers && onMarkerDragEnd && m.id) {
            marker.addListener('dragend', () => {
              const p = marker.getPosition();
              if (p) onMarkerDragEnd(m.id, { lat: p.lat(), lng: p.lng() });
            });
          }
          layer.overlays.push(marker);
          points.push({ lat: m.lat, lng: m.lng });
        });
        if (safeLine.length > 1) {
          const polyline = new layer.maps.Polyline({
            path: safeLine.map(([lat, lng]) => ({ lat, lng })),
            geodesic: false, strokeColor: '#16A34A', strokeOpacity: 0.95, strokeWeight: 6,
            map,
          });
          layer.overlays.push(polyline);
          safeLine.forEach(([lat, lng]) => points.push({ lat, lng }));
        }
        if (signature !== fittedRef.current && points.length) {
          if (points.length === 1) {
            map.setCenter(points[0]); map.setZoom(16);
          } else {
            const bounds = new layer.maps.LatLngBounds();
            points.forEach((point) => bounds.extend(point));
            map.fitBounds(bounds, 36);
          }
          fittedRef.current = signature;
        }
        return;
      }

      layer.clearLayers();
      const points = [];
      safeMarkers.forEach((m) => {
        const marker = L.marker([m.lat, m.lng], {
          icon: pinIcon(m.emoji, m.color), draggable: draggableMarkers,
        }).addTo(layer);
        if (draggableMarkers && onMarkerDragEnd && m.id) {
          marker.on('dragend', () => {
            const p = marker.getLatLng();
            onMarkerDragEnd(m.id, { lat: p.lat, lng: p.lng });
          });
        }
        points.push([m.lat, m.lng]);
      });
      if (safeLine.length > 1) {
        L.polyline(safeLine, { color: '#16A34A', weight: 5, opacity: 0.9 }).addTo(layer);
        safeLine.forEach((p) => points.push(p));
      }
      if (signature !== fittedRef.current && points.length) {
        if (points.length === 1) map.setView(points[0], 16);
        else map.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
        fittedRef.current = signature;
      }
      map.invalidateSize();
    } catch {
      // Invalid map payload must not blank the booking screen.
    }
  }, [mapReady, JSON.stringify(markers), JSON.stringify(line), draggableMarkers, onMarkerDragEnd]);

  return <div ref={el} className="map-box" style={{ height }} />;
}
