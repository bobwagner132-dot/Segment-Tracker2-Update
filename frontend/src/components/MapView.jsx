import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import { useTheme } from "@/lib/theme";

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

const TILE_CONFIG = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OSM &copy; CARTO",
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; OSM &copy; CARTO",
  },
};

export default function MapView({
  points = [],
  color = "#00E5FF",
  overlayPoints = null,
  overlayColor = "#CCFF00",
  height = 420,
  testid = "map-view",
}) {
  const { theme } = useTheme();
  const positions = useMemo(() => points.map((p) => [p.lat, p.lon]), [points]);
  const overlayPositions = useMemo(
    () => (overlayPoints ? overlayPoints.map((p) => [p.lat, p.lon]) : []),
    [overlayPoints]
  );

  if (positions.length === 0) {
    return (
      <div
        data-testid={`${testid}-empty`}
        className="border border-line bg-surface flex items-center justify-center text-muted text-xs tracking-[0.2em] uppercase"
        style={{ height }}
      >
        No route data
      </div>
    );
  }

  const start = positions[0];
  const end = positions[positions.length - 1];
  const tile = TILE_CONFIG[theme] || TILE_CONFIG.dark;

  return (
    <div
      data-testid={testid}
      className="border border-line overflow-hidden bg-surface"
      style={{ height }}
    >
      <MapContainer
        center={start}
        zoom={13}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer url={tile.url} attribution={tile.attribution} subdomains="abcd" maxZoom={19} />
        <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.9 }} />
        {overlayPositions.length > 0 && (
          <Polyline
            positions={overlayPositions}
            pathOptions={{ color: overlayColor, weight: 6, opacity: 1 }}
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
