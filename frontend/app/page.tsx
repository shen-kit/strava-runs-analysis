"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";
import { DistanceBar } from "@/src/components/Charts";

export default function Home() {
  const summary = useQuery({ queryKey: ["stats", "summary"], queryFn: api.summary });
  const totals = useQuery({ queryKey: ["stats", "totals", "week"], queryFn: () => api.totals("week") });
  const pbs = useQuery({ queryKey: ["stats", "personal-bests"], queryFn: api.personalBests });
  const recent = useQuery({ queryKey: ["activities", { limit: 8 }], queryFn: () => api.activities("limit=8") });
  const s = summary.data;
  const chart = (totals.data ?? []).slice(-16).map((r) => ({ ...r, distance_km: Number((r.distance_m / 1000).toFixed(1)) }));
  return <main className="mx-auto max-w-6xl space-y-6 p-4">
    <h1 className="text-3xl font-bold">Running dashboard</h1>
    {summary.isLoading ? <p>Loading…</p> : <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Card label="Runs" value={s?.total_runs ?? 0}/><Card label="Distance" value={formatDistance(s?.total_distance_m)}/><Card label="Moving time" value={formatDuration(s?.total_moving_time_s)}/><Card label="Elevation" value={formatElevation(s?.total_elevation_gain_m)}/><Card label="Avg pace" value={formatPace(s?.average_pace_s_per_km)}/><Card label="Longest" value={formatDistance(s?.longest_run_distance_m)}/>
    </section>}
    <section className="card"><h2 className="mb-3 text-xl font-semibold">Weekly distance</h2><DistanceBar data={chart}/></section>
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="card"><h2 className="mb-3 text-xl font-semibold">Personal bests</h2><table className="table"><tbody>{(pbs.data ?? []).map((pb) => <tr key={pb.distance_m}><td>{formatDistance(pb.distance_m)}</td><td>{formatDuration(pb.duration_s)}</td><td>{formatPace(pb.pace_s_per_km)}</td><td><Link href={`/activities/${pb.activity_id}`}>{pb.activity_title}</Link></td></tr>)}</tbody></table></div>
      <div className="card"><h2 className="mb-3 text-xl font-semibold">Recent runs</h2><table className="table"><tbody>{(recent.data ?? []).map((a) => <tr key={a.id}><td><Link href={`/activities/${a.id}`}>{a.title}</Link></td><td>{formatDate(a.local_date)}</td><td>{formatDistance(a.source_distance_m)}</td><td>{formatPace(a.avg_pace_s_per_km)}</td></tr>)}</tbody></table></div>
    </section>
  </main>;
}
function Card({ label, value }: { label: string; value: ReactNode }) { return <div className="card"><div className="text-xs uppercase text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>; }
