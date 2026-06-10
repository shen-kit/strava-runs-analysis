"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, CartesianGrid } from "recharts";
import { formatPace } from "@/src/lib/format";

export function DistanceBar({ data }: { data: Array<Record<string, string | number | null>> }) {
  return <div className="h-72"><ResponsiveContainer><BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket"/><YAxis/><Tooltip/><Bar dataKey="distance_km" fill="#2563eb"/></BarChart></ResponsiveContainer></div>;
}

type ChartRow = Record<string, string | number | null | undefined>;

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

export function StreamLine({ data, yKey, name, kind = "generic", noData, xDomainKm }: { data: ChartRow[]; yKey: string; name: string; kind?: "pace" | "elevation" | "generic"; noData?: string; xDomainKm?: [number, number] }) {
  const chartData = kind === "pace" ? data.map((d) => {
    const v = d[yKey];
    return { ...d, [yKey]: typeof v === "number" && Number.isFinite(v) ? Math.min(v, 8) : null };
  }) : data;
  const valid = chartData.filter((d) => typeof d[yKey] === "number" && Number.isFinite(d[yKey] as number));
  if (!valid.length) return <div className="rounded bg-slate-100 p-6 text-slate-500">{noData ?? "No data"}</div>;
  const yValues = valid.map((d) => d[yKey] as number).filter((v) => kind !== "pace" || (v > 1 && v <= 8));
  const domain = kind === "pace" ? [Math.max(0, Math.min(...yValues) - 0.25), 8] as [number, number] : kind === "elevation" ? valueDomain(yValues, 2) : ["auto", "auto"];
  const yTick = (v: number) => kind === "pace" ? formatPace(v * 60).replace(" /km", "") : kind === "elevation" ? `${Math.round(v)}m` : String(v);
  const tooltipFormatter = (v: unknown) => {
    const n = Number(v);
    if (kind === "pace") return formatPace(n * 60);
    if (kind === "elevation") return `${Math.round(n)} m`;
    return n;
  };
  return <div className="h-56"><ResponsiveContainer><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="km" type="number" tickFormatter={distanceTick} label={{ value: "Distance (km)", position: "insideBottom", offset: -4 }} domain={xDomainKm ?? ["dataMin", "dataMax"]}/><YAxis tickFormatter={yTick} domain={domain} reversed={kind === "pace"}/><Tooltip formatter={tooltipFormatter} labelFormatter={(v) => `Distance ${distanceTick(Number(v))}`}/><Line dot={false} connectNulls={false} type="monotone" dataKey={yKey} name={name} stroke="#16a34a"/></LineChart></ResponsiveContainer></div>;
}
