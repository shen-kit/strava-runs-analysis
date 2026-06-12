"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import maplibregl, { LngLatBounds, Map, type ExpressionSpecification, type Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type RouteOverlayMetric } from "@/src/lib/api";
import { useSettings } from "@/src/components/SettingsContext";
import { formatPace } from "@/src/lib/format";

type RoutePoint = [number, number, number | null];
type ColourMode = "none" | RouteOverlayMetric;
type MapStyleId = "satellite" | "street";
type ColourStop = { value: number; colour: string };

const mapStyles: Record<MapStyleId, { label: string; tileUrl?: string; attribution: string; tileSize: number }> = {
  satellite: {
    label: "Satellite",
    tileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL_SATELLITE,
    attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION_SATELLITE ?? process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "",
    tileSize: Number(process.env.NEXT_PUBLIC_MAP_TILE_SIZE_SATELLITE ?? process.env.NEXT_PUBLIC_MAP_TILE_SIZE ?? 256),
  },
  street: {
    label: "Streets",
    tileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL_STREET,
    attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION_STREET ?? process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "",
    tileSize: Number(process.env.NEXT_PUBLIC_MAP_TILE_SIZE_STREET ?? process.env.NEXT_PUBLIC_MAP_TILE_SIZE ?? 256),
  },
};
const mapStyleEntries = Object.entries(mapStyles) as [MapStyleId, (typeof mapStyles)[MapStyleId]][];
const metricLabels: Record<RouteOverlayMetric, string> = { pace: "Pace", heart_rate: "Heart rate", gradient: "Gradient", cadence: "Cadence" };

function validPoints(points: RoutePoint[]) {
  return points.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function formatMetricValue(metric: RouteOverlayMetric, value: number): string {
  if (metric === "pace") return formatPace(value);
  if (metric === "heart_rate") return `${Math.round(value)} bpm`;
  if (metric === "cadence") return `${Math.round(value)} spm`;
  const rounded = Math.round(value * 10) / 10;
  return `${Object.is(rounded, -0) ? "0.0" : rounded.toFixed(1)}%`;
}

function colourStops(metric: RouteOverlayMetric, min: number | null | undefined, max: number | null | undefined): ColourStop[] {
  const rawMin = finiteNumber(min);
  const rawMax = finiteNumber(max);
  const fallbackMin = metric === "gradient" ? -8 : 0;
  const fallbackMax = metric === "gradient" ? 8 : 1;
  const lo = rawMin ?? fallbackMin;
  const hi = rawMax != null && rawMax > lo ? rawMax : rawMin != null ? rawMin + 1 : fallbackMax;

  if (metric === "pace") return [{ value: lo, colour: "#16a34a" }, { value: hi, colour: "#dc2626" }];
  if (metric === "heart_rate" || metric === "cadence") return [{ value: lo, colour: "#2563eb" }, { value: hi, colour: "#dc2626" }];
  if (lo < 0 && hi > 0) return [{ value: lo, colour: "#2563eb" }, { value: 0, colour: "#22c55e" }, { value: hi, colour: "#dc2626" }];
  if (hi <= 0) return [{ value: lo, colour: "#2563eb" }, { value: hi, colour: "#22c55e" }];
  return [{ value: lo, colour: "#22c55e" }, { value: hi, colour: "#dc2626" }];
}

function colourExpression(metric: RouteOverlayMetric, min: number | null | undefined, max: number | null | undefined): ExpressionSpecification {
  const expression: unknown[] = ["interpolate", ["linear"], ["get", "value"]];
  for (const stop of colourStops(metric, min, max)) expression.push(stop.value, stop.colour);
  return expression as ExpressionSpecification;
}

function mapTileConfig(mapType: MapStyleId) {
  const requested = mapStyles[mapType];
  return { id: mapType, ...requested };
}

function mapEnvName(mapType: MapStyleId) {
  return mapType === "satellite" ? "NEXT_PUBLIC_MAP_TILE_URL_SATELLITE" : "NEXT_PUBLIC_MAP_TILE_URL_STREET";
}

function legendGradient(metric: RouteOverlayMetric, min: number, max: number): string {
  if (min === max) return colourStops(metric, min, max)[0].colour;
  const stops = colourStops(metric, min, max);
  const lo = stops[0].value;
  const hi = stops[stops.length - 1].value;
  const span = hi - lo || 1;
  const cssStops = stops.map((stop) => `${stop.colour} ${Math.max(0, Math.min(100, ((stop.value - lo) / span) * 100))}%`).join(", ");
  return `linear-gradient(to right, ${cssStops})`;
}

export function RouteMap({ activityId, points }: { activityId: number; points: RoutePoint[] }) {
  const { settings } = useSettings();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const tooltipRef = useRef<Popup | null>(null);
  const [mode, setMode] = useState<ColourMode>(settings.maps.defaultOverlay);
  const [mapType, setMapType] = useState<MapStyleId>(settings.maps.defaultMapType);
  useEffect(() => { setMode(settings.maps.defaultOverlay); }, [settings.maps.defaultOverlay]);
  useEffect(() => { setMapType(settings.maps.defaultMapType); }, [settings.maps.defaultMapType]);
  const route = useMemo(() => validPoints(points ?? []), [points]);
  const queryMetric: RouteOverlayMetric = mode === "none" ? "pace" : mode;
  const overlay = useQuery({
    queryKey: ["activity", activityId, "route-overlay", queryMetric],
    queryFn: () => api.routeOverlay(activityId, queryMetric),
    enabled: !!activityId && route.length > 0,
  });
  const legend = useMemo(() => {
    if (mode === "none" || overlay.data?.metric !== mode) return null;
    const min = finiteNumber(overlay.data.min_value);
    const max = finiteNumber(overlay.data.max_value);
    if (min == null || max == null) return null;
    return {
      metric: mode,
      title: metricLabels[mode],
      min,
      max,
      gradient: legendGradient(mode, min, max),
    };
  }, [mode, overlay.data]);

  useEffect(() => {
    const tile = mapTileConfig(mapType);
    if (!containerRef.current || !tile.tileUrl || route.length === 0) return;
    const coordinates = route.map(([lat, lon, ele]) => ele == null ? [lon, lat] : [lon, lat, ele]);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: { [tile.id]: { type: "raster", tiles: [tile.tileUrl], tileSize: tile.tileSize, attribution: tile.attribution } }, layers: [{ id: tile.id, type: "raster", source: tile.id }] },
      center: [coordinates[0][0], coordinates[0][1]],
      zoom: 14,
    });
    mapRef.current = map;
    tooltipRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "route-tooltip" });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } } });
      map.addLayer({ id: "route-shadow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 7, "line-opacity": mode === "none" ? 0.55 : 0 } });
      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f97316", "line-width": 4, "line-opacity": mode === "none" ? 0.95 : 0 } });

      const metricMode = mode === "none" ? null : mode;
      const metricOverlay = metricMode && overlay.data?.metric === metricMode && overlay.data.geojson?.features?.length ? overlay.data : null;
      if (metricOverlay && metricMode) {
        map.addSource("metric-route", { type: "geojson", data: metricOverlay.geojson });
        map.addLayer({ id: "metric-route-line", type: "line", source: "metric-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colourExpression(metricMode, metricOverlay.min_value, metricOverlay.max_value), "line-width": 5, "line-opacity": 0.95 } });
        map.on("mousemove", "metric-route-line", (event) => {
          const value = finiteNumber(event.features?.[0]?.properties?.value);
          if (value == null) {
            map.getCanvas().style.cursor = "";
            tooltipRef.current?.remove();
            return;
          }
          map.getCanvas().style.cursor = "crosshair";
          tooltipRef.current
            ?.setLngLat(event.lngLat)
            .setHTML(`<div>${metricLabels[metricMode]}: ${formatMetricValue(metricMode, value)}</div>`)
            .addTo(map);
        });
        map.on("mouseleave", "metric-route-line", () => {
          map.getCanvas().style.cursor = "";
          tooltipRef.current?.remove();
        });
      }

      if (overlay.data?.paused_geojson?.features?.length) {
        map.addSource("paused-route", { type: "geojson", data: overlay.data.paused_geojson });
        map.addLayer({ id: "paused-route-line", type: "line", source: "paused-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#94a3b8", "line-width": 3, "line-opacity": 0.8, "line-dasharray": [1, 1.5] } });
      }

      if (overlay.data?.markers?.length) {
        map.addSource("markers", { type: "geojson", data: { type: "FeatureCollection", features: overlay.data.markers.map((m) => ({ type: "Feature", properties: { type: m.type }, geometry: { type: "Point", coordinates: m.coordinates } })) } });
        map.addLayer({ id: "marker-points", type: "circle", source: "markers", paint: { "circle-radius": ["match", ["get", "type"], "pause", 5, 7], "circle-color": ["match", ["get", "type"], "start", "#22c55e", "finish", "#ef4444", "pause", "#facc15", "#fff"], "circle-stroke-color": "#111827", "circle-stroke-width": 2 } });
      }

      if (coordinates.length === 1) {
        map.setCenter([coordinates[0][0], coordinates[0][1]]);
        map.setZoom(16);
      } else {
        const bounds = coordinates.reduce((b, c) => b.extend([c[0], c[1]]), new LngLatBounds([coordinates[0][0], coordinates[0][1]], [coordinates[0][0], coordinates[0][1]]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
      }
    });

    return () => {
      tooltipRef.current?.remove();
      tooltipRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [route, overlay.data, mode, mapType]);

  if (!mapTileConfig(mapType).tileUrl) return <div className="empty-state min-h-80">Set {mapEnvName(mapType)} to view {mapStyles[mapType].label.toLowerCase()} map tiles.</div>;
  if (!route.length) return <div className="empty-state min-h-80">No route data.</div>;

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-canvas" />
      <div className="map-select grid gap-2">
        <select value={mode} onChange={(e) => setMode(e.target.value as ColourMode)} className="select map-overlay text-sm">
          <option value="none">Default</option>
          <option value="pace">Pace</option>
          <option value="heart_rate" disabled={overlay.data ? !overlay.data.has_heart_rate : false}>Heart rate</option>
          <option value="gradient">Hill gradient</option>
          <option value="cadence" disabled={overlay.data ? !overlay.data.has_cadence : false}>Cadence</option>
        </select>
        <select value={mapType} onChange={(e) => setMapType(e.target.value as MapStyleId)} className="select map-overlay text-sm">
          {mapStyleEntries.map(([id, style]) => <option key={id} value={id} disabled={!style.tileUrl}>{style.label}</option>)}
        </select>
      </div>
      {legend && (
        <div className="map-legend">
          <div className="mb-1 font-semibold">{legend.title}</div>
          <div className="h-3 rounded-full ring-1 ring-black/10 dark:ring-white/30" style={{ background: legend.gradient }} />
          {legend.min === legend.max ? (
            <div className="mt-1 text-center muted">{formatMetricValue(legend.metric, legend.min)}</div>
          ) : (
            <div className="mt-1 flex justify-between gap-2 muted">
              <span>{formatMetricValue(legend.metric, legend.min)}</span>
              <span>{formatMetricValue(legend.metric, legend.max)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
