"use client";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";
import { RouteMap } from "@/src/components/RouteMap";
import { StreamLine } from "@/src/components/Charts";

export default function ActivityDetailPage() {
  const id = Number(useParams().id);
  const activity = useQuery({ queryKey: ["activity", id], queryFn: () => api.activity(id), enabled: !!id });
  const route = useQuery({ queryKey: ["activity", id, "route"], queryFn: () => api.route(id), enabled: !!id });
  const splits = useQuery({ queryKey: ["activity", id, "splits"], queryFn: () => api.splits(id), enabled: !!id });
  const best = useQuery({ queryKey: ["activity", id, "best-efforts"], queryFn: () => api.bestEfforts(id), enabled: !!id });
  const streams = useQuery({ queryKey: ["activity", id, "streams", "pace,heart_rate,cadence,elevation"], queryFn: () => api.streams(id), enabled: !!id });
  const a = activity.data;
  const xDomainKm: [number, number] | undefined = streams.data?.x_domain_m ? [streams.data.x_domain_m[0] / 1000, streams.data.x_domain_m[1] / 1000] : undefined;
  const streamRows = (name: string, valueKey: string, transform: (v: number) => number = (v) => v) => (streams.data?.streams?.[name] ?? []).map(([d, v]: [number, number | null]) => ({ km: d / 1000, [valueKey]: v == null ? null : transform(v) }));
  const elevationRows = streamRows("elevation", "elevation");

  return <main className="page-shell page-stack">
    {activity.isLoading ? <div className="status">Loading activity…</div> : activity.isError ? <div className="error-state">Activity failed to load.</div> : !a ? <div className="empty-state">Activity not found.</div> : <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{a.title}</h1>
          <p className="page-subtitle">{formatDate(a.local_date)} · {formatDistance(a.source_distance_m)} · {formatDuration(a.moving_time_s)}</p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Date" value={formatDate(a.local_date)}/>
        <Card label="Distance" value={formatDistance(a.source_distance_m)}/>
        <Card label="Time" value={formatDuration(a.moving_time_s)}/>
        <Card label="Pace" value={formatPace(a.avg_pace_s_per_km)}/>
        <Card label="Elevation" value={formatElevation(a.elevation_gain_m)}/>
        <Card label="Avg HR" value={a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}/>
        <Card label="Cadence" value={a.avg_cadence_spm ? Math.round(a.avg_cadence_spm) : "—"}/>
        <Card label="Source file" value={a.source_filename ?? "—"}/>
      </section>

      <section className="card">
        <div className="section-heading"><div><h2 className="section-title">Distance check</h2><p className="section-subtitle">Source distance compared with cleaned track distance.</p></div></div>
        <p className="muted">Source: <b className="text-foreground">{formatDistance(a.source_distance_m)}</b> · Computed: <b className="text-foreground">{formatDistance(a.computed_distance_m)}</b> · Difference: <b className="text-foreground">{formatDistance((a.source_distance_m ?? 0) - (a.computed_distance_m ?? 0))}</b></p>
      </section>

      <section className="card map-card">
        <div className="section-heading"><div><h2 className="section-title">Route</h2><p className="section-subtitle">Map route with optional pace, heart rate, gradient, or cadence overlay.</p></div></div>
        {route.isLoading ? <div className="status">Loading route…</div> : route.isError ? <div className="error-state">Route failed to load.</div> : <RouteMap activityId={id} points={route.data?.simplified_points_json ?? []}/>}
        <p className="mt-3 text-sm muted">{route.data?.simplified_point_count ?? 0}/{route.data?.original_point_count ?? 0} points, tolerance {route.data?.simplification_tolerance_m ?? "—"} m</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="section-heading"><div><h2 className="section-title">Splits</h2><p className="section-subtitle">Per-kilometre pacing and effort.</p></div></div>
          {splits.isLoading ? <div className="status">Loading splits…</div> : <SplitsTable rows={splits.data ?? []} />}
        </div>
        <div className="card">
          <div className="section-heading"><div><h2 className="section-title">Best efforts</h2><p className="section-subtitle">Fastest efforts within this activity.</p></div></div>
          {best.isLoading ? <div className="status">Loading best efforts…</div> : <BestTable rows={best.data ?? []} />}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <StreamCard title="Pace" subtitle="Pace stream with elevation context."><StreamLine data={streamRows("pace", "pace", (v) => v / 60)} yKey="pace" name="min/km" kind="pace" noData="No pace data" xDomainKm={xDomainKm} elevationData={elevationRows} /></StreamCard>
        <StreamCard title="Elevation" subtitle="Elevation profile over distance."><StreamLine data={elevationRows} yKey="elevation" name="m" kind="elevation" noData="No elevation data" xDomainKm={xDomainKm} /></StreamCard>
        <StreamCard title="Heart rate" subtitle="Heart rate stream with elevation context."><StreamLine data={streamRows("heart_rate", "heart_rate")} yKey="heart_rate" name="bpm" xDomainKm={xDomainKm} elevationData={elevationRows} /></StreamCard>
        <StreamCard title="Cadence" subtitle="Cadence stream with elevation context."><StreamLine data={streamRows("cadence", "cadence")} yKey="cadence" name="spm" xDomainKm={xDomainKm} elevationData={elevationRows} /></StreamCard>
      </section>
    </>}
  </main>;
}

function Card({ label, value }: { label: string; value: ReactNode }) { return <div className="metric-card"><div className="metric-label">{label}</div><div className="metric-value text-lg">{value}</div></div>; }
function StreamCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { return <div className="chart-card"><div className="section-heading"><div><h2 className="section-title">{title}</h2><p className="section-subtitle">{subtitle}</p></div></div>{children}</div>; }
function SplitsTable({ rows }: { rows: { id: number; split_index: number; duration_s: number; avg_pace_s_per_km?: number | null; avg_heart_rate_bpm?: number | null }[] }) { if (!rows.length) return <div className="empty-state">No splits data</div>; return <div className="table-wrap"><table className="table"><thead><tr><th>Split</th><th>Time</th><th>Pace</th><th>HR</th></tr></thead><tbody>{rows.map((s) => <tr key={s.id}><td>Km {s.split_index}</td><td>{formatDuration(s.duration_s)}</td><td>{formatPace(s.avg_pace_s_per_km)}</td><td>{s.avg_heart_rate_bpm ? Math.round(s.avg_heart_rate_bpm) : "—"}</td></tr>)}</tbody></table></div>; }
function BestTable({ rows }: { rows: { distance_m: number; duration_s: number; pace_s_per_km: number }[] }) { if (!rows.length) return <div className="empty-state">No best-effort data</div>; return <div className="table-wrap"><table className="table"><thead><tr><th>Distance</th><th>Time</th><th>Pace</th></tr></thead><tbody>{rows.map((b) => <tr key={b.distance_m}><td>{formatDistance(b.distance_m)}</td><td>{formatDuration(b.duration_s)}</td><td>{formatPace(b.pace_s_per_km)}</td></tr>)}</tbody></table></div>; }
