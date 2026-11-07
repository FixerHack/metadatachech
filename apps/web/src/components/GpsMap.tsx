import { useEffect, useRef } from "react";
import L from "leaflet";

interface Props {
  lat: number;
  lon: number;
  zoom?: number;
  /** When set, clicking the map moves the marker and reports the point. */
  onPick?: (lat: number, lon: number) => void;
  /** Hide the marker (e.g. picker with no point yet). */
  noMarker?: boolean;
}

export function GpsMap({ lat, lon, zoom = 14, onPick, noMarker }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { scrollWheelZoom: false }).setView([lat, lon], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => pickRef.current?.(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Map is created once; position updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (noMarker) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.circleMarker([lat, lon], { radius: 9, color: "#d93f3f", weight: 3, fillOpacity: 0.35 }).addTo(map);
    } else {
      markerRef.current.setLatLng([lat, lon]);
    }
    if (!map.getBounds().contains([lat, lon])) map.panTo([lat, lon]);
  }, [lat, lon, noMarker]);

  return <div ref={ref} className={`map ${onPick ? "pickable" : ""}`} />;
}
