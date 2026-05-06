import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const bounds = points.map((p) => [p.lat, p.lon]);
    try {
      map.fitBounds(bounds, { padding: [24, 24] });
    } catch {
      /* empty */
    }
  }, [map, points]);
  return null;
}

export default function MapView({
  points = [],
  color = "#00E5FF",
  overlayPoints = null,
  overlayColor = "#CCFF00",
  height = 420,
  testid = "map-view",
}) {
  const positions = useMemo(() => points.map((p) => [p.lat, p.lon]), [points]);
  const overlayPositions = useMemo(
    () => (overlayPoints ? overlayPoints.map((p) => [p.lat, p.lon]) : []),
    [overlayPoints]
  );

  if (positions.length === 0) {
    return (
      <div
        data-testid={`${testid}-empty`}
        className="border border-white/10 bg-[#0A0A0C] flex items-center justify-center text-white/40 text-xs tracking-[0.2em] uppercase"
        style={{ height }}
      >
        No route data
      </div>
    );
  }

  const start = positions[0];
  const end = positions[positions.length - 1];

  return (
    <div
      data-testid={testid}
      className="border border-white/10 overflow-hidden bg-[#0A0A0C]"
      style={{ height }}
    >
      <MapContainer
        center={start}
        zoom={13}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OSM &copy; CARTO'
          subdomains="abcd"
          maxZoom={19}
        />
        <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.9 }} />
        {overlayPositions.length > 0 && (
          <Polyline
            positions={overlayPositions}
            pathOptions={{ color: overlayColor, weight: 5, opacity: 0.95 }}
          />
        )}
        <CircleMarker
          center={start}
          radius={6}
          pathOptions={{ color: "#00E5FF", fillColor: "#00E5FF", fillOpacity: 1 }}
        />
        <CircleMarker
          center={end}
          radius={6}
          pathOptions={{ color: "#FF3B30", fillColor: "#FF3B30", fillOpacity: 1 }}
        />
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
