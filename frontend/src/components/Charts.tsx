"use client";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { formatPace } from "@/src/lib/format";
import { ResponsiveChart } from "@/src/components/ResponsiveChart";

const C = { blue: "var(--chart-1)", green: "var(--chart-2)", orange: "var(--chart-3)", purple: "var(--chart-4)", elevation: "var(--chart-muted)" };
const zonePalette = [C.blue, C.green, C.orange, C.purple, "#e11d48", "#0891b2", "#84cc16", "#f59e0b"];

export function DistanceBar({ data }: { data: Array<Record<string, string | number | null>> }) {
  return <ResponsiveChart className="chart-wrap"><BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket"/><YAxis/><Tooltip/><Bar dataKey="distance_km" fill={C.blue} radius={[4,4,0,0]}/></BarChart></ResponsiveChart>;
}

type ChartRow = Record<string, string | number | null | undefined>;
export type ZoneBand = { label: string; min: number; max: number; color?: string };

function distanceTick(km: number) {
  if (!Number.isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

function valueDomain(values: number[], pad: number) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return ["auto", "auto"] as [string, string];
  const min = Math.min(...clean), max = Math.max(...clean);
  if (min === max) return [min - pad, max + pad] as [number, number];
  const p = Math.max((max - min) * 0.1, pad);
  return [Math.max(0, min - p), max + p] as [number, number];
}

function visibleZoneBands(bands: ZoneBand[] = [], values: number[], domain: [string, string] | [number, number]) {
  if (typeof domain[0] !== "number" || typeof domain[1] !== "number") return [];
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return [];
  const dataMin = Math.min(...clean), dataMax = Math.max(...clean);
  const [domainMin, domainMax] = domain;
  return bands
    .map((band, i) => ({ ...band, color: band.color ?? zonePalette[i % zonePalette.length] }))
    .filter((band) => band.max >= dataMin && band.min <= dataMax)
    .map((band) => ({ ...band, y1: Math.max(domainMin, band.min), y2: Math.min(domainMax, band.max) }))
    .filter((band) => band.y2 > band.y1);
}

function mergeElevation(data: ChartRow[], elevationData?: ChartRow[]) {
  if (!elevationData?.length) return data;
  const elevation = elevationData
    .map((row) => ({ km: Number(row.km), elevation: row.elevation }))
    .filter((row): row is { km: number; elevation: number } => Number.isFinite(row.km) && typeof row.elevation === "number" && Number.isFinite(row.elevation))
    .sort((a, b) => a.km - b.km);
  if (!elevation.length) return data;

  const byKm = new Map<number, ChartRow>();
  for (const row of data) {
    const km = Number(row.km);
    if (Number.isFinite(km)) byKm.set(km, { ...row });
  }
  for (const row of elevation) {
    const existing = byKm.get(row.km) ?? { km: row.km };
    existing.elevationOverlay = row.elevation;
    byKm.set(row.km, existing);
  }

  const rows = [...byKm.values()].sort((a, b) => Number(a.km) - Number(b.km));
  let j = 0;
  for (const row of rows) {
    const km = Number(row.km);
    if (!Number.isFinite(km) || typeof row.elevationOverlay === "number") continue;
    while (j < elevation.length - 1 && elevation[j + 1].km < km) j++;
    const prev = elevation[j];
    const next = elevation[j + 1];
    if (prev && next && prev.km <= km && km <= next.km && next.km > prev.km) {
      const f = (km - prev.km) / (next.km - prev.km);
      row.elevationOverlay = prev.elevation + (next.elevation - prev.elevation) * f;
    } else {
      row.elevationOverlay = null;
    }
  }
  return rows;
}

export function StreamLine({ data, yKey, name, kind = "generic", noData, xDomainKm, elevationData, pauses = [], zoneBands = [] }: { data: ChartRow[]; yKey: string; name: string; kind?: "pace" | "elevation" | "generic"; noData?: string; xDomainKm?: [number, number]; elevationData?: ChartRow[]; pauses?: { start_distance_m: number; end_distance_m: number; duration_s: number }[]; zoneBands?: ZoneBand[] }) {
  const hasPaceSlowerThan8 = kind === "pace" && data.some((d) => {
    const v = d[yKey];
    return typeof v === "number" && Number.isFinite(v) && v > 8;
  });
  const mainData = kind === "pace" ? data.map((d) => {
    const v = d[yKey];
    return { ...d, [yKey]: typeof v === "number" && Number.isFinite(v) ? Math.min(v, 8) : null };
  }) : data;
  const chartData = mergeElevation(mainData, kind === "elevation" ? undefined : elevationData);
  const valid = chartData.filter((d) => typeof d[yKey] === "number" && Number.isFinite(d[yKey] as number));
  if (!valid.length) return <div className="empty-state">{noData ?? "No data"}</div>;
  const yValues = valid.map((d) => d[yKey] as number).filter((v) => kind !== "pace" || (v > 1 && v <= 8));
  const domain = kind === "pace"
    ? (hasPaceSlowerThan8 ? [Math.max(0, Math.min(...yValues) - 0.25), 8] as [number, number] : valueDomain(yValues, 0.25))
    : kind === "elevation" || zoneBands.length ? valueDomain(yValues, 2) : ["auto", "auto"] as [string, string];
  const elevationValues = chartData.map((d) => d.elevationOverlay).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const elevationDomain = valueDomain(elevationValues, 2);
  const hasElevationOverlay = kind !== "elevation" && elevationValues.length > 0;
  const yTick = (v: number) => kind === "pace" ? formatPace(v * 60).replace(" /km", "") : kind === "elevation" ? `${Math.round(v)}m` : String(v);
  const relevantZoneBands = visibleZoneBands(zoneBands, yValues, domain);
  const tooltipFormatter = (v: unknown, n: unknown) => {
    const num = Number(v);
    if (n === "Elevation") return `${Math.round(num)} m`;
    if (kind === "pace") return formatPace(num * 60);
    if (kind === "elevation") return `${Math.round(num)} m`;
    return num;
  };
  const Chart = hasElevationOverlay ? ComposedChart : LineChart;
  return <><ResponsiveChart className="chart-wrap-sm"><Chart data={chartData}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="km" type="number" tickFormatter={distanceTick} label={{ value: "Distance (km)", position: "insideBottom", offset: -4 }} domain={xDomainKm ?? ["dataMin", "dataMax"]}/><YAxis yAxisId="left" tickFormatter={yTick} domain={domain} reversed={kind === "pace"}/>{hasElevationOverlay && <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${Math.round(v)}m`} domain={elevationDomain} width={42} stroke={C.elevation}/>} {relevantZoneBands.map((band) => <ReferenceArea key={band.label} yAxisId="left" y1={band.y1} y2={band.y2} fill={band.color} fillOpacity={0.12} strokeOpacity={0} ifOverflow="hidden" />)}<Tooltip formatter={tooltipFormatter} labelFormatter={(v) => `Distance ${distanceTick(Number(v))}`}/>{pauses.map((p, i) => <ReferenceArea key={i} x1={p.start_distance_m / 1000} x2={p.end_distance_m / 1000} yAxisId="left" fill="var(--chart-muted)" fillOpacity={0.5} strokeOpacity={0} />)}{hasElevationOverlay && <Area yAxisId="right" type="monotone" dataKey="elevationOverlay" name="Elevation" stroke={C.elevation} strokeOpacity={0.4} fill={C.elevation} fillOpacity={0.16} connectNulls={false} isAnimationActive={false}/>}<Line yAxisId="left" dot={false} connectNulls={hasElevationOverlay} type="monotone" dataKey={yKey} name={name} stroke={C.green} strokeWidth={2}/></Chart></ResponsiveChart>{relevantZoneBands.length > 0 && <div className="zone-legend" aria-label="Zone colours">{relevantZoneBands.map((band) => <span className="zone-legend-item" key={band.label}><span className="zone-legend-swatch" style={{ backgroundColor: band.color }} />{band.label}</span>)}</div>}</>;
}
