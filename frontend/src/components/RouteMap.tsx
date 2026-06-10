"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import maplibregl, { LngLatBounds, Map, type ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type RouteOverlayMetric } from "@/src/lib/api";

type RoutePoint = [number, number, number | null];
type ColourMode = "none" | RouteOverlayMetric;
const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL;
const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "";
function validPoints(points: RoutePoint[]) { return points.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)); }

function colourExpression(metric: RouteOverlayMetric, min: number, max: number): ExpressionSpecification {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max > lo ? max : lo + 1;
  if (metric === "pace") return ["interpolate", ["linear"], ["get", "value"], lo, "#16a34a", hi, "#dc2626"];
  if (metric === "gradient") return ["interpolate", ["linear"], ["get", "value"], -8, "#2563eb", 0, "#22c55e", 8, "#dc2626"];
  return ["interpolate", ["linear"], ["get", "value"], lo, "#2563eb", hi, "#dc2626"];
}

export function RouteMap({ activityId, points }: { activityId: number; points: RoutePoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const [mode, setMode] = useState<ColourMode>("none");
  const route = useMemo(() => validPoints(points ?? []), [points]);
  const queryMetric: RouteOverlayMetric = mode === "none" ? "pace" : mode;
  const overlay = useQuery({ queryKey: ["activity", activityId, "route-overlay", queryMetric], queryFn: () => api.routeOverlay(activityId, queryMetric), enabled: !!activityId && route.length > 0 });

  useEffect(() => {
    if (!containerRef.current || !tileUrl || route.length === 0) return;
    const coordinates = route.map(([lat, lon, ele]) => ele == null ? [lon, lat] : [lon, lat, ele]);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: { satellite: { type: "raster", tiles: [tileUrl], tileSize: 256, attribution } }, layers: [{ id: "satellite", type: "raster", source: "satellite" }] },
      center: [coordinates[0][0], coordinates[0][1]], zoom: 14,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } } });
      map.addLayer({ id: "route-shadow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 7, "line-opacity": 0.55 } });
      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f97316", "line-width": 4, "line-opacity": 0.95 } });
      if (overlay.data?.markers?.length) {
        map.addSource("markers", { type: "geojson", data: { type: "FeatureCollection", features: overlay.data.markers.map((m) => ({ type: "Feature", properties: { type: m.type }, geometry: { type: "Point", coordinates: m.coordinates } })) } });
        map.addLayer({ id: "marker-points", type: "circle", source: "markers", paint: { "circle-radius": ["match", ["get", "type"], "pause", 5, 7], "circle-color": ["match", ["get", "type"], "start", "#22c55e", "finish", "#ef4444", "pause", "#facc15", "#fff"], "circle-stroke-color": "#111827", "circle-stroke-width": 2 } });
      }
      if (mode !== "none" && overlay.data?.geojson?.features?.length) {
        map.addSource("metric-route", { type: "geojson", data: overlay.data.geojson });
        map.addLayer({ id: "metric-route-line", type: "line", source: "metric-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colourExpression(queryMetric, overlay.data.min_value ?? 0, overlay.data.max_value ?? 1), "line-width": 5, "line-opacity": 0.95 } });
      }
      if (coordinates.length === 1) { map.setCenter([coordinates[0][0], coordinates[0][1]]); map.setZoom(16); }
      else {
        const bounds = coordinates.reduce((b, c) => b.extend([c[0], c[1]]), new LngLatBounds([coordinates[0][0], coordinates[0][1]], [coordinates[0][0], coordinates[0][1]]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
      }
    });
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, [route, overlay.data, mode, queryMetric]);

  if (!tileUrl) return <div className="h-80 rounded bg-slate-100 p-6 text-slate-500">Map tile URL not configured.</div>;
  if (!route.length) return <div className="h-80 rounded bg-slate-100 p-6 text-slate-500">No route data.</div>;
  return <div className="relative"><div ref={containerRef} className="h-120 w-full overflow-hidden rounded bg-slate-900" /><select value={mode} onChange={(e) => setMode(e.target.value as ColourMode)} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-sm shadow"><option value="none">Default</option><option value="pace">Pace</option><option value="heart_rate" disabled={overlay.data ? !overlay.data.has_heart_rate : false}>Heart rate</option><option value="gradient">Hill gradient</option><option value="cadence" disabled={overlay.data ? !overlay.data.has_cadence : false}>Cadence</option></select><div className="absolute bottom-3 left-3 rounded bg-white/85 px-2 py-1 text-xs shadow"><span className="mr-2 text-green-600">● Start</span><span className="mr-2 text-red-600">● Finish</span><span className="text-yellow-500">● Pause</span></div></div>;
}
