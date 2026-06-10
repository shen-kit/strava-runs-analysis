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
  return <main className="mx-auto max-w-6xl space-y-6 p-4">{!a ? <p>Loading…</p> : <>
    <h1 className="text-3xl font-bold">{a.title}</h1>
    <section className="grid gap-3 md:grid-cols-4"><Card label="Date" value={formatDate(a.local_date)}/><Card label="Distance" value={formatDistance(a.source_distance_m)}/><Card label="Time" value={formatDuration(a.moving_time_s)}/><Card label="Pace" value={formatPace(a.avg_pace_s_per_km)}/><Card label="Elevation" value={formatElevation(a.elevation_gain_m)}/><Card label="Avg HR" value={a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}/><Card label="Cadence" value={a.avg_cadence_spm ? Math.round(a.avg_cadence_spm) : "—"}/><Card label="Source file" value={a.source_filename ?? "—"}/></section>
    <section className="card"><h2 className="mb-3 text-xl font-semibold">Source vs computed distance</h2><p>Source: {formatDistance(a.source_distance_m)} · Computed from cleaned track: {formatDistance(a.computed_distance_m)} · Difference: {formatDistance((a.source_distance_m ?? 0) - (a.computed_distance_m ?? 0))}</p></section>
    <section className="card"><h2 className="mb-3 text-xl font-semibold">Route</h2><RouteMap points={route.data?.simplified_points_json ?? []}/><p className="mt-2 text-sm text-slate-500">{route.data?.simplified_point_count ?? 0}/{route.data?.original_point_count ?? 0} points, tolerance {route.data?.simplification_tolerance_m ?? "—"} m</p></section>
    <section className="grid gap-4 lg:grid-cols-2"><div className="card"><h2 className="mb-3 text-xl font-semibold">Splits</h2><table className="table"><tbody>{(splits.data ?? []).map((s) => <tr key={s.id}><td>Km {s.split_index}</td><td>{formatDuration(s.duration_s)}</td><td>{formatPace(s.avg_pace_s_per_km)}</td><td>{s.avg_heart_rate_bpm ? Math.round(s.avg_heart_rate_bpm) : "—"}</td></tr>)}</tbody></table></div>
    <div className="card"><h2 className="mb-3 text-xl font-semibold">Best efforts</h2><table className="table"><tbody>{(best.data ?? []).map((b) => <tr key={b.distance_m}><td>{formatDistance(b.distance_m)}</td><td>{formatDuration(b.duration_s)}</td><td>{formatPace(b.pace_s_per_km)}</td></tr>)}</tbody></table></div></section>
    <section className="grid gap-4 lg:grid-cols-2"><div className="card"><h2 className="mb-2 text-lg font-semibold">Pace</h2><StreamLine data={streamRows("pace", "pace", (v) => v / 60)} yKey="pace" name="min/km" kind="pace" noData="No pace data" xDomainKm={xDomainKm} /></div><div className="card"><h2 className="mb-2 text-lg font-semibold">Elevation</h2><StreamLine data={streamRows("elevation", "elevation")} yKey="elevation" name="m" kind="elevation" noData="No elevation data" xDomainKm={xDomainKm} /></div><div className="card"><h2 className="mb-2 text-lg font-semibold">Heart rate</h2><StreamLine data={streamRows("heart_rate", "heart_rate")} yKey="heart_rate" name="bpm" xDomainKm={xDomainKm} /></div><div className="card"><h2 className="mb-2 text-lg font-semibold">Cadence</h2><StreamLine data={streamRows("cadence", "cadence")} yKey="cadence" name="spm" xDomainKm={xDomainKm} /></div></section>
  </>}</main>;
}
function Card({ label, value }: { label: string; value: ReactNode }) { return <div className="card"><div className="text-xs uppercase text-slate-500">{label}</div><div className="mt-1 break-words text-lg font-semibold">{value}</div></div>; }
