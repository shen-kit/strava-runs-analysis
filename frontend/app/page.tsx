"use client";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type BestEffortDistanceSetting, type PersonalBest, type StatRow, type TotalRow } from "@/src/lib/api";
import { useSettings } from "@/src/components/SettingsContext";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";

type ChartRow = Record<string, string | number | null>;
type Bucket = "week" | "month" | "year";
const C = { blue: "var(--chart-1)", green: "var(--chart-2)", orange: "var(--chart-3)", purple: "var(--chart-4)", muted: "var(--chart-muted)", text: "var(--foreground)" };
const palette = [C.blue, C.green, C.orange, C.purple, C.muted, "#e11d48", "#0891b2", "#84cc16", "#f59e0b", "#a855f7"];
function n(v: unknown) { return typeof v === "number" ? v : Number(v ?? 0); }
function kmTick(v: number) { return `${v.toFixed(0)}km`; }
function paceTick(v: number) { return formatPace(v).replace(" /km", ""); }
function round2(v: unknown): string | number { return typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(2)) : String(v ?? ""); }
function effortLabel(d: number, distances: BestEffortDistanceSetting[] = []) { return distances.find((x) => x.distance_m === d)?.label ?? formatDistance(d); }
function effortKey(d: number) { return `d${String(d).replace(/\D/g, "_")}`; }
function monday(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addMonths(d: Date, m: number) { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
function isoDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function dateToBucket(value: string, bucket: Bucket) {
  const d = new Date(`${value}T00:00:00`);
  if (bucket === "year") return String(d.getFullYear());
  return bucket === "week" ? isoDate(monday(d)) : monthKey(d);
}
function periodCount(bucket: Bucket, range: string) {
  const months = range === "3mo" ? 3 : range === "1y" ? 12 : range === "2y" ? 24 : range === "5y" ? 60 : 6;
  if (bucket === "week") return Math.max(4, Math.round(months * 4.345));
  if (bucket === "month") return months;
  return Math.max(1, Math.ceil(months / 12));
}
function buildKeys(bucket: Bucket, offset: number, range: string) {
  const count = periodCount(bucket, range);
  if (bucket === "year") {
    const end = new Date().getFullYear() + offset * count;
    return Array.from({length: count}, (_, i) => String(end - count + 1 + i));
  }
  const end = bucket === "week" ? monday(new Date()) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  if (bucket === "week") {
    end.setDate(end.getDate() + offset * count * 7);
    const start = new Date(end); start.setDate(start.getDate() - (count - 1) * 7);
    return Array.from({length: count}, (_,i) => { const d = new Date(start); d.setDate(d.getDate()+i*7); return isoDate(d); });
  }
  end.setMonth(end.getMonth() + offset * count);
  const start = addMonths(end, -(count - 1));
  return Array.from({length: count}, (_,i) => monthKey(addMonths(start, i)));
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
  const { settings, distances } = useSettings();
  const enabledDistances = useMemo(() => distances.filter((d) => d.enabled).sort((a, b) => (a.sort_order - b.sort_order) || (a.distance_m - b.distance_m)), [distances]);
  const defaultBucket = settings.dashboard.defaultBucket;
  const defaultRange = settings.dashboard.defaultTimeRange;
  const [bucket, setBucket] = useState<Bucket>(defaultBucket);
  const [range, setRange] = useState(defaultRange);
  const [offset, setOffset] = useState(0);
  useEffect(() => { setBucket(defaultBucket); setRange(defaultRange); setOffset(0); }, [defaultBucket, defaultRange]);
  const visible = settings.dashboard.visibleSections;
  const keys = useMemo(() => buildKeys(bucket, offset, range), [bucket, offset, range]);
  const trendDistances = enabledDistances.map((d) => d.distance_m).join(",");

  const summary = useQuery({ queryKey: ["stats", "summary"], queryFn: api.summary });
  const totals = useQuery({ queryKey: ["stats", "totals", bucket], queryFn: () => api.totals(bucket) });
  const consistency = useQuery({ queryKey: ["stats", "consistency"], queryFn: api.consistency });
  const pbs = useQuery({ queryKey: ["stats", "personal-bests", trendDistances], queryFn: api.personalBests });
  const effortTrend = useQuery({ queryKey: ["stats", "best-effort-trend", trendDistances], queryFn: () => api.bestEffortTrend(trendDistances), enabled: enabledDistances.length > 0 });
  const longRun = useQuery({ queryKey: ["stats", "long-run-progression", bucket], queryFn: () => api.longRunProgression(bucket) });
  const paceTrend = useQuery({ queryKey: ["stats", "pace-trend", bucket], queryFn: () => api.paceTrend(bucket) });
  const elevation = useQuery({ queryKey: ["stats", "elevation", bucket], queryFn: () => api.elevation(bucket) });
  const distribution = useQuery({ queryKey: ["stats", "distance-distribution"], queryFn: api.distanceDistribution });
  const recent = useQuery({ queryKey: ["activities", "recent"], queryFn: () => api.activities("limit=15") });
  function setB(b: Bucket) { setBucket(b); setOffset(0); }

  const volumeRows = useMemo(() => fillTotals(totals.data, keys), [totals.data, keys]);
  const effortRows = useMemo(() => buildEffortRows(effortTrend.data ?? [], keys, bucket), [effortTrend.data, keys, bucket]);
  const longRows = fillByBucket(longRun.data, keys, "longest_run_distance_m", "distance_km", 1/1000);
  const paceRows = (paceTrend.data ?? []).filter((r) => keys.includes(String(r.bucket))).map((r) => ({ bucket:String(r.bucket), pace:r.pace_s_per_km == null ? null : n(r.pace_s_per_km) }));
  const paceFilled = keys.map((k) => paceRows.find((r) => r.bucket === k) ?? { bucket:k, pace:null });
  const elevationRows = fillByBucket(elevation.data, keys, "elevation_gain_m", "elevation_m");
  const distRows = (distribution.data ?? []).map((r) => ({ bucket: String(r.bucket), run_count: n(r.run_count), distance_km: n(r.distance_m) / 1000 }));
  const s = summary.data;

  return <main className="page-shell page-stack">
    <div className="page-header">
      <div><h1 className="page-title">Running dashboard</h1><p className="page-subtitle">Training volume, consistency, trends, and recent run history.</p></div>
      <div className="toolbar" aria-label="Dashboard range controls">
        <button className="btn btn-sm" onClick={() => setOffset(offset-1)}>←</button>
        <button className={`btn btn-sm ${bucket==="week" ? "btn-active" : ""}`} onClick={() => setB("week")}>Week</button>
        <button className={`btn btn-sm ${bucket==="month" ? "btn-active" : ""}`} onClick={() => setB("month")}>Month</button>
        <button className={`btn btn-sm ${bucket==="year" ? "btn-active" : ""}`} onClick={() => setB("year")}>Year</button>
        <select className="select btn-sm" value={range} onChange={(e) => { setRange(e.target.value); setOffset(0); }}><option value="3mo">3mo</option><option value="6mo">6mo</option><option value="1y">1y</option><option value="2y">2y</option><option value="5y">5y</option></select>
        <button className="btn btn-sm" onClick={() => setOffset(0)}>Today</button>
        <button className="btn btn-sm" onClick={() => setOffset(offset+1)} disabled={offset>=0}>→</button>
      </div>
    </div>

    {visible.summary && (summary.isLoading ? <Loading text="Loading summary…" /> : summary.isError ? <ErrorState text="Summary failed to load." /> : <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8"><Card label="Runs" value={s?.total_runs ?? 0}/><Card label="Distance" value={formatDistance(s?.total_distance_m)}/><Card label="Moving time" value={formatDuration(s?.total_moving_time_s)}/><Card label="Elevation" value={formatElevation(s?.total_elevation_gain_m)}/><Card label="Avg pace" value={formatPace(s?.average_pace_s_per_km)}/><Card label="Longest" value={formatDistance(s?.longest_run_distance_m)}/><Card label="This month" value={formatDistance(s?.current_month_distance_m)}/><Card label="This year" value={formatDistance(s?.current_year_distance_m)}/></section>)}

    <section className="grid gap-4 xl:grid-cols-2">
      {visible.weeklyVolume && <ChartSection title={`${bucket} distance`} subtitle="Distance bars with rolling 4-period average."><Volume data={volumeRows} bucket={bucket}/></ChartSection>}
      {visible.trainingConsistency && <ChartSection title="Training consistency" subtitle="Run frequency and active days by period."><Consistency data={volumeRows} summary={consistency.data}/></ChartSection>}
      {visible.bestEffortTrend && <ChartSection title="Rolling best-effort trend" subtitle="Fastest enabled efforts in range."><BestEffortTrend data={effortRows} distances={enabledDistances}/></ChartSection>}
      {visible.longRun && <ChartSection title="Long run progression" subtitle="Longest run completed each period."><SimpleBar data={longRows} dataKey="distance_km" yLabel="Longest run" yTick={kmTick}/></ChartSection>}
      {visible.paceTrend && <ChartSection title="Average pace trend" subtitle="Lower values indicate faster average pace."><PaceTrend data={paceFilled}/></ChartSection>}
      {visible.elevationTrend && <ChartSection title="Elevation trend" subtitle="Total elevation gain by period."><SimpleBar data={elevationRows} dataKey="elevation_m" yLabel="Elevation" yTick={(v) => `${Math.round(v)}m`}/></ChartSection>}
      {visible.distanceDistribution && <ChartSection title="Distance distribution" subtitle="Run count and total distance by activity distance bucket."><Distribution data={distRows}/></ChartSection>}
      {visible.personalBests && <div className="chart-card"><div className="section-heading"><div><h2 className="section-title">Personal bests</h2><p className="section-subtitle">Fastest enabled efforts detected from imported runs.</p></div></div><PersonalBests data={pbs.data ?? []} distances={enabledDistances}/></div>}
    </section>

    {visible.recentRuns && <section className="card"><div className="section-heading"><div><h2 className="section-title">Recent runs</h2><p className="section-subtitle">Latest imported activities.</p></div></div>{recent.isLoading ? <Loading text="Loading recent runs…" /> : recent.isError ? <ErrorState text="Recent runs failed to load." /> : <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Title</th><th>Distance</th><th>Time</th><th>Pace</th><th>Elev</th><th>HR</th><th>Cadence</th></tr></thead><tbody>{(recent.data ?? []).map((a) => <tr key={a.id}><td>{formatDate(a.local_date)}</td><td><Link href={`/activities/${a.id}`}>{a.title}</Link></td><td>{formatDistance(a.source_distance_m ?? a.computed_distance_m)}</td><td>{formatDuration(a.moving_time_s)}</td><td>{formatPace(a.avg_pace_s_per_km)}</td><td>{formatElevation(a.elevation_gain_m)}</td><td>{a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}</td><td>{a.avg_cadence_spm ? Math.round(a.avg_cadence_spm) : "—"}</td></tr>)}</tbody></table></div>}</section>}
  </main>;
}

function Card({ label, value }: { label: string; value: ReactNode }) { return <div className="metric-card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>; }
function ChartSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) { return <section className="chart-card"><div className="section-heading"><div><h2 className="section-title">{title}</h2>{subtitle && <p className="section-subtitle">{subtitle}</p>}</div></div>{children}</section>; }
function Empty({ text = "No data" }) { return <div className="empty-state">{text}</div>; }
function Loading({ text = "Loading…" }) { return <div className="status">{text}</div>; }
function ErrorState({ text }: { text: string }) { return <div className="error-state">{text}</div>; }
function ChartWrap({ children }: { children: ReactNode }) { return <div className="chart-wrap"><ResponsiveContainer>{children}</ResponsiveContainer></div>; }
function Tip() { return <Tooltip formatter={(v) => round2(v)}/>; }
function Volume({ data, bucket }: { data: ChartRow[]; bucket: Bucket }) { if (!data.length) return <Empty/>; return <ChartWrap><ComposedChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value: bucket, position:"insideBottom", offset:-4}}/><YAxis tickFormatter={kmTick} label={{value:"Distance", angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey="distance_km" name="Distance km" fill={C.blue} radius={[4,4,0,0]}/><Line type="monotone" dataKey="rolling_km" name="4-period avg km" stroke={C.orange} strokeWidth={2} dot={false}/></ComposedChart></ChartWrap>; }
function Consistency({ data, summary }: { data: ChartRow[]; summary?: {current_week_count:number; average_runs_per_week:number} }) { if (!data.length) return <Empty/>; return <><div className="mb-3 text-sm muted">Current week: <b>{summary?.current_week_count ?? 0}</b> runs · Avg active week: <b>{(summary?.average_runs_per_week ?? 0).toFixed(1)}</b> runs</div><ChartWrap><ComposedChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Period", position:"insideBottom", offset:-4}}/><YAxis label={{value:"Count", angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey="runs" name="Runs" fill={C.green} radius={[4,4,0,0]}/><Line type="monotone" dataKey="days_run" name="Days run" stroke={C.text} strokeWidth={2} dot={false}/></ComposedChart></ChartWrap></>; }
function BestEffortTrend({ data, distances }: { data: ChartRow[]; distances: BestEffortDistanceSetting[] }) { if (data.length < 2 || !distances.length) return <Empty text="Not enough best-effort data"/>; return <ChartWrap><LineChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" label={{value:"Date", position:"insideBottom", offset:-4}}/><YAxis tickFormatter={paceTick} reversed label={{value:"Pace", angle:-90, position:"insideLeft"}}/><Tooltip formatter={(v) => typeof v === "number" ? paceTick(v) : v}/>{distances.map((d, i) => <Line key={d.distance_m} type="monotone" dataKey={effortKey(d.distance_m)} name={d.label} stroke={palette[i % palette.length]} strokeWidth={2} dot={false} connectNulls/>)}</LineChart></ChartWrap>; }
function SimpleBar({ data, dataKey, yLabel, yTick }: { data: ChartRow[]; dataKey: string; yLabel: string; yTick: (v:number)=>string }) { if (!data.length) return <Empty/>; return <ChartWrap><BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Period", position:"insideBottom", offset:-4}}/><YAxis tickFormatter={yTick} label={{value:yLabel, angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey={dataKey} fill={C.blue} radius={[4,4,0,0]}/></BarChart></ChartWrap>; }
function PaceTrend({ data }: { data: ChartRow[] }) { if (!data.length) return <Empty/>; return <ChartWrap><LineChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Period", position:"insideBottom", offset:-4}}/><YAxis tickFormatter={paceTick} reversed label={{value:"Avg pace", angle:-90, position:"insideLeft"}}/><Tooltip formatter={(v) => typeof v === "number" ? paceTick(v) : v}/><Line type="monotone" dataKey="pace" stroke={C.blue} strokeWidth={2} dot={false}/></LineChart></ChartWrap>; }
function Distribution({ data }: { data: ChartRow[] }) { if (!data.length) return <Empty/>; return <ChartWrap><BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" label={{value:"Distance bucket", position:"insideBottom", offset:-4}}/><YAxis label={{value:"Count / km", angle:-90, position:"insideLeft"}}/><Tip/><Bar dataKey="run_count" name="Runs" fill={C.blue} radius={[4,4,0,0]}/><Bar dataKey="distance_km" name="Distance km" fill={C.muted} radius={[4,4,0,0]}/></BarChart></ChartWrap>; }
function PersonalBests({ data, distances }: { data: PersonalBest[]; distances: BestEffortDistanceSetting[] }) { if (!data.length) return <Empty/>; return <div className="table-wrap"><table className="table"><thead><tr><th>Distance</th><th>Time</th><th>Pace</th><th>Activity</th><th>Date</th></tr></thead><tbody>{data.map((pb) => <tr key={pb.distance_m}><td>{pb.label ?? effortLabel(pb.distance_m, distances)}</td><td>{formatDuration(pb.duration_s)}</td><td>{formatPace(pb.pace_s_per_km)}</td><td><Link href={`/activities/${pb.activity_id}`}>{pb.activity_title}</Link></td><td>{formatDate(pb.local_date)}</td></tr>)}</tbody></table></div>; }
function buildEffortRows(rows: StatRow[], keys: string[], bucket: Bucket): ChartRow[] { const byBucket = new Map<string, ChartRow>(); for (const key of keys) byBucket.set(key, { date: key }); for (const r of rows) { const b = dateToBucket(String(r.local_date), bucket); if (!keys.includes(b)) continue; const key = effortKey(n(r.distance_m)); const row = byBucket.get(b) ?? { date: b }; const pace = n(r.pace_s_per_km); if (row[key] == null || pace < n(row[key])) row[key] = pace; byBucket.set(b, row); } return keys.map((k) => byBucket.get(k) ?? { date:k }); }
