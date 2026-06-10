"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl, { LngLatBounds, Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type RoutePoint = [number, number, number | null];

const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL;
const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "";

function validPoints(points: RoutePoint[]) {
  return points.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
}

export function RouteMap({ points }: { points: RoutePoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const route = useMemo(() => validPoints(points ?? []), [points]);

  useEffect(() => {
    if (!containerRef.current || !tileUrl || route.length === 0) return;

    const coordinates = route.map(([lat, lon, ele]) => (
      ele == null ? [lon, lat] : [lon, lat, ele]
    ));

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: [tileUrl],
            tileSize: 256,
            attribution,
          },
        },
        layers: [{ id: "satellite", type: "raster", source: "satellite" }],
      },
      center: [coordinates[0][0], coordinates[0][1]],
      zoom: 14,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        },
      });

      map.addLayer({
        id: "route-shadow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#000000", "line-width": 7, "line-opacity": 0.55 },
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#f97316", "line-width": 4, "line-opacity": 0.95 },
      });

      if (coordinates.length === 1) {
        map.setCenter([coordinates[0][0], coordinates[0][1]]);
        map.setZoom(16);
      } else {
        const bounds = coordinates.reduce(
          (b, c) => b.extend([c[0], c[1]]),
          new LngLatBounds([coordinates[0][0], coordinates[0][1]], [coordinates[0][0], coordinates[0][1]])
        );
        map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
      }
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [route]);

  if (!tileUrl) return <div className="h-80 rounded bg-slate-100 p-6 text-slate-500">Map tile URL not configured.</div>;
  if (!route.length) return <div className="h-80 rounded bg-slate-100 p-6 text-slate-500">No route data.</div>;

  return <div ref={containerRef} className="h-80 w-full overflow-hidden rounded bg-slate-900" />;
}
