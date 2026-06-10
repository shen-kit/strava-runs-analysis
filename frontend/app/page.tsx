"use client";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type PersonalBest, type StatRow, type TotalRow } from "@/src/lib/api";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";

type ChartRow = Record<string, string | number | null>;
type Visibility = Record<string, boolean>;
type Bucket = "week" | "month";
const CHARTS = ["volume", "consistency", "bestEfforts", "longRun", "pace", "distribution"];
const PB_LABELS: Record<number, string> = { 400: "400m", 800: "800m", 1000: "1km", 1609.344: "1 mile", 5000: "5km", 10000: "10km", 15000: "15km", 21097.5: "Half", 42195: "Marathon" };
function n(v: unknown) { return typeof v === "number" ? v : Number(v ?? 0); }
function kmTick(v: number) { return `${v.toFixed(0)}km`; }
function paceTick(v: number) { return formatPace(v).replace(" /km", ""); }
function round2(v: unknown): string | number { return typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(2)) : String(v ?? ""); }
function effortLabel(d: number) { return PB_LABELS[d] ?? formatDistance(d); }
function monday(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addMonths(d: Date, m: number) { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
function isoDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function dateToBucket(value: string, bucket: Bucket) {
  const d = new Date(`${value}T00:00:00`);
  return bucket === "week" ? isoDate(monday(d)) : monthKey(d);
}
function buildKeys(bucket: Bucket, offset: number) {
  const end = bucket === "week" ? monday(new Date()) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  if (bucket === "week") {
    end.setDate(end.getDate() + offset * 26 * 7);
    const start = new Date(end); start.setDate(start.getDate() - 25 * 7);
    return Array.from({length:26}, (_,i) => { const d = new Date(start); d.setDate(d.getDate()+i*7); return isoDate(d); });
  }
  end.setMonth(end.getMonth() + offset * 24);
  const start = addMonths(end, -23);
  return Array.from({length:24}, (_,i) => monthKey(addMonths(start, i)));
}
function fillTotals(rows: TotalRow[] = [], keys: string[]) {
  const by = new Map(rows.map((r) => [r.bucket, r]));
  const filled = keys.map((k) => by.get(k) ?? { bucket:k, run_count:0, days_run:0, distance_m:0, moving_time_s:0, elevation_gain_m:0 });
  return filled.map((r, i) => {
    const window = filled.slice(Math.max(0, i-3), i+1);
    return { bucket:r.bucket, distance_km:r.distance_m/1000, rolling_km:window.reduce((s,x)=>s+x.distance_m,0)/window.length/1000, runs:r.run_count, days_run:r.days_run ?? 0, elevation_m:r.elevation_gain_m, pace:r.distance_m>0 && r.moving_time_s>0 ? r.moving_time_s/(r.distance_m/1000) : null };
  });
}
function fillByBucket(rows: StatRow[] = [], keys: string[], field: string, outKey: string, scale = 1) { const by = new Map(rows.map((r) => [String(r.bucket), r])); return keys.map((k) => ({ bucket:k, [outKey]: by.has(k) ? n(by.get(k)?.[field]) * scale : 0 })); }

export default function Home() {
  const [bucket, setBucket] = useState<Bucket>("week");
  const [offset, setOffset] = useState(0);
  const keys = useMemo(() => buildKeys(bucket, offset), [bucket, offset]);
  const summary = useQuery({ queryKey: ["stats", "summary"], queryFn: api.summary });
  const totals = useQuery({ queryKey: ["stats", "totals", bucket], queryFn: () => api.totals(bucket) });
  const consistency = useQuery({ queryKey: ["stats", "consistency"], queryFn: api.consistency });
  const pbs = useQuery({ queryKey: ["stats", "personal-bests"], queryFn: api.personalBests });
  const effortTrend = useQuery({ queryKey: ["stats", "best-effort-trend", "1000,5000,10000"], queryFn: () => api.bestEffortTrend("1000,5000,10000") });
  const longRun = useQuery({ queryKey: ["stats", "long-run-progression", bucket], queryFn: () => api.longRunProgression(bucket) });
  const paceTrend = useQuery({ queryKey: ["stats", "pace-trend", bucket], queryFn: () => api.paceTrend(bucket) });
  const distribution = useQuery({ queryKey: ["stats", "distance-distribution"], queryFn: api.distanceDistribution });
  const recent = useQuery({ queryKey: ["activities", "recent"], queryFn: () => api.activities("limit=15") });
  const [visible, setVisible] = useState<Visibility>(() => { const d = Object.fromEntries(CHARTS.map((c) => [c, true])); if (typeof window === "undefined") return d; const raw = localStorage.getItem("dashboardChartVisibility"); return raw ? { ...d, ...JSON.parse(raw) } : d; });
  function toggle(key: string) { setVisible((v) => { const next = { ...v, [key]: !v[key] }; localStorage.setItem("dashboardChartVisibility", JSON.stringify(next)); return next; }); }
  function setB(b: Bucket) { setBucket(b); setOffset(0); }

  const volumeRows = useMemo(() => fillTotals(totals.data, keys), [totals.data, keys]);
  const effortRows = useMemo(() => buildEffortRows(effortTrend.data ?? [], keys, bucket), [effortTrend.data, keys, bucket]);
  const longRows = fillByBucket(longRun.data, keys, "longest_run_distance_m", "distance_km", 1/1000);
  const paceRows = (paceTrend.data ?? []).filter((r) => keys.includes(String(r.bucket))).map((r) => ({ bucket:String(r.bucket), pace:r.pace_s_per_km == null ? null : n(r.pace_s_per_km) }));
  const paceFilled = keys.map((k) => paceRows.find((r) => r.bucket === k) ?? { bucket:k, pace:null });
  const distRows = (distribution.data ?? []).map((r) => ({ bucket: String(r.bucket), run_count: n(r.run_count), distance_km: n(r.distance_m) / 1000 }));
  const s = summary.data;

  return <main className="mx-auto max-w-7xl space-y-6 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-bold">Running dashboard</h1><div className="flex items-center gap-2"><button className="rounded border px-2 py-1" onClick={() => setOffset(offset-1)}>←</button><button className={`rounded border px-3 py-1 ${bucket==="week" ? "bg-slate-900 text-white" : ""}`} onClick={() => setB("week")}>Weekly (6mo)</button><button className={`rounded border px-3 py-1 ${bucket==="month" ? "bg-slate-900 text-white" : ""}`} onClick={() => setB("month")}>Monthly (2y)</button><button className="rounded border px-3 py-1" onClick={() => setOffset(0)}>Today</button><button className="rounded border px-2 py-1" onClick={() => setOffset(offset+1)} disabled={offset>=0}>→</button></div></div>
    {summary.isLoading ? <p>Loading…</p> : <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8"><Card label="Runs" value={s?.total_runs ?? 0}/><Card label="Distance" value={formatDistance(s?.total_distance_m)}/><Card label="Moving time" value={formatDuration(s?.total_moving_time_s)}/><Card label="Elevation" value={formatElevation(s?.total_elevation_gain_m)}/><Card label="Avg pace" value={formatPace(s?.average_pace_s_per_km)}/><Card label="Longest" value={formatDistance(s?.longest_run_distance_m)}/><Card label="This month" value={formatDistance(s?.current_month_distance_m)}/><Card label="This year" value={formatDistance(s?.current_year_distance_m)}/></section>}
    <section className="grid gap-4 xl:grid-cols-2">
      <ChartSection id="volume" title={`${bucket === "week" ? "Weekly" : "Monthly"} distance`} visible={visible.volume} onToggle={toggle}><Volume data={volumeRows} bucket={bucket}/></ChartSection>
      <ChartSection id="consistency" title="Training consistency" visible={visible.consistency} onToggle={toggle}><Consistency data={volumeRows} summary={consistency.data}/></ChartSection>
      <ChartSection id="bestEfforts" title="Rolling best-effort trend" visible={visible.bestEfforts} onToggle={toggle}><BestEffortTrend data={effortRows}/></ChartSection>
      <ChartSection id="longRun" title="Long run progression" visible={visible.longRun} onToggle={toggle}><SimpleBar data={longRows} dataKey="distance_km" yLabel="Longest run" yTick={kmTick}/></ChartSection>
      <ChartSection id="pace" title="Average pace trend" visible={visible.pace} onToggle={toggle}><PaceTrend data={paceFilled}/></ChartSection>
      <ChartSection id="distribution" title="Distance distribution" visible={visible.distribution} onToggle={toggle}><Distribution data={distRows}/></ChartSection>
      <div className="card"><h2 className="mb-3 text-xl font-semibold">Personal bests</h2><PersonalBests data={pbs.data ?? []}/></div>
    </section>
    <section className="card overflow-x-auto"><h2 className="mb-3 text-xl font-semibold">Recent runs</h2><table className="table"><thead><tr><th>Date</th><th>Title</th><th>Distance</th><th>Time</th><th>Pace</th><th>Elev</th><th>HR</th><th>Cadence</th></tr></thead><tbody>{(recent.data ?? []).map((a) => <tr key={a.id}><td>{formatDate(a.local_date)}</td><td><Link href={`/activities/${a.id}`}>{a.title}</Link></td><td>{formatDistance(a.source_distance_m)}</td><td>{formatDuration(a.moving_time_s)}</td><td>{formatPace(a.avg_pace_s_per_km)}</td><td>{formatElevation(a.elevation_gain_m)}</td><td>{a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}</td><td>{a.avg_cadence_spm ? Math.round(a.avg_cadence_spm) : "—"}</td></tr>)}</tbody></table></section>
  </main>;
}

function Card({ label, value }: { label: string; value: ReactNode }) { return <div className="card"><div className="text-xs uppercase text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>; }
function ChartSection({ id, title, visible, onToggle, children }: { id: string; title: string; visible: boolean; onToggle: (id: string) => void; children: ReactNode }) { return <section className="card"><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button className="rounded border px-2 py-1 text-sm" onClick={() => onToggle(id)}>{visible ? "Hide" : "Show"}</button></div>{visible ? children : <p className="text-sm text-slate-500">Hidden</p>}</section>; }
function Empty({ text = "No data" }) { return <div className="rounded bg-slate-100 p-6 text-slate-500">{text}</div>; }
function ChartWrap({ children }: { children: ReactNode }) { return <div className="h-72"><ResponsiveContainer>{children}</ResponsiveContainer></div>; }
function Tip() { return <Tooltip formatter={(v) => round2(v)}/>; }
function Volume({ data, bucket }: { data: ChartRow[]; bucket: Bucket }) { if (!data.length) return <Empty/>; return <ChartWrap><ComposedChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value: bucket, position:"insideBottom", offset:-4}}/><YAxis tickFormatter={kmTick} label={{value:"Distance", angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey="distance_km" name="Distance km" fill="#2563eb"/><Line type="monotone" dataKey="rolling_km" name="4-period avg km" stroke="#f97316" dot={false}/></ComposedChart></ChartWrap>; }
function Consistency({ data, summary }: { data: ChartRow[]; summary?: {current_week_count:number; average_runs_per_week:number} }) { if (!data.length) return <Empty/>; return <><div className="mb-2 text-sm text-slate-600">Current week: <b>{summary?.current_week_count ?? 0}</b> runs · Avg active week: <b>{(summary?.average_runs_per_week ?? 0).toFixed(1)}</b> runs</div><ChartWrap><ComposedChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Period", position:"insideBottom", offset:-4}}/><YAxis label={{value:"Count", angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey="runs" name="Runs" fill="#16a34a"/><Line type="monotone" dataKey="days_run" name="Days run" stroke="#0f172a"/></ComposedChart></ChartWrap></>; }
function BestEffortTrend({ data }: { data: ChartRow[] }) { if (data.length < 2) return <Empty text="Not enough best-effort data"/>; return <ChartWrap><LineChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" label={{value:"Date", position:"insideBottom", offset:-4}}/><YAxis tickFormatter={paceTick} reversed label={{value:"Pace", angle:-90, position:"insideLeft"}}/><Tooltip formatter={(v) => typeof v === "number" ? paceTick(v) : v}/><Line type="monotone" dataKey="1km" stroke="#2563eb" dot={false} connectNulls/><Line type="monotone" dataKey="5km" stroke="#16a34a" dot={false} connectNulls/><Line type="monotone" dataKey="10km" stroke="#f97316" dot={false} connectNulls/></LineChart></ChartWrap>; }
function SimpleBar({ data, dataKey, yLabel, yTick }: { data: ChartRow[]; dataKey: string; yLabel: string; yTick: (v:number)=>string }) { if (!data.length) return <Empty/>; return <ChartWrap><BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Period", position:"insideBottom", offset:-4}}/><YAxis tickFormatter={yTick} label={{value:yLabel, angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey={dataKey} fill="#2563eb"/></BarChart></ChartWrap>; }
function PaceTrend({ data }: { data: ChartRow[] }) { if (!data.length) return <Empty/>; return <ChartWrap><LineChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Period", position:"insideBottom", offset:-4}}/><YAxis tickFormatter={paceTick} reversed label={{value:"Avg pace", angle:-90, position:"insideLeft"}}/><Tooltip formatter={(v) => typeof v === "number" ? paceTick(v) : v}/><Line type="monotone" dataKey="pace" stroke="#2563eb" dot={false}/></LineChart></ChartWrap>; }
function Distribution({ data }: { data: ChartRow[] }) { if (!data.length) return <Empty/>; return <ChartWrap><BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Distance bucket", position:"insideBottom", offset:-4}}/><YAxis label={{value:"Count / km", angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey="run_count" name="Runs" fill="#2563eb"/><Bar dataKey="distance_km" name="Distance km" fill="#94a3b8"/></BarChart></ChartWrap>; }
function PersonalBests({ data }: { data: PersonalBest[] }) { if (!data.length) return <Empty/>; return <table className="table"><thead><tr><th>Distance</th><th>Time</th><th>Pace</th><th>Activity</th><th>Date</th></tr></thead><tbody>{data.map((pb) => <tr key={pb.distance_m}><td>{effortLabel(pb.distance_m)}</td><td>{formatDuration(pb.duration_s)}</td><td>{formatPace(pb.pace_s_per_km)}</td><td><Link href={`/activities/${pb.activity_id}`}>{pb.activity_title}</Link></td><td>{formatDate(pb.local_date)}</td></tr>)}</tbody></table>; }
function buildEffortRows(rows: StatRow[], keys: string[], bucket: Bucket): ChartRow[] { const byBucket = new Map<string, ChartRow>(); for (const key of keys) byBucket.set(key, { date: key }); for (const r of rows) { const b = dateToBucket(String(r.local_date), bucket); if (!keys.includes(b)) continue; const key = n(r.distance_m) === 1000 ? "1km" : n(r.distance_m) === 5000 ? "5km" : n(r.distance_m) === 10000 ? "10km" : null; if (!key) continue; const row = byBucket.get(b) ?? { date: b }; const pace = n(r.pace_s_per_km); if (row[key] == null || pace < n(row[key])) row[key] = pace; byBucket.set(b, row); } return keys.map((k) => byBucket.get(k) ?? { date:k }); }
