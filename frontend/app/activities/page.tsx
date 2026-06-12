"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";

export default function ActivitiesPage() {
  const q = useQuery({ queryKey: ["activities", { limit: 100 }], queryFn: () => api.activities("limit=100") });
  return <main className="page-shell page-stack">
    <div className="page-header">
      <div>
        <h1 className="page-title">Activities</h1>
        <p className="page-subtitle">Recent imported runs with key training metrics.</p>
      </div>
    </div>
    <section className="card">
      <div className="section-heading"><div><h2 className="section-title">Run history</h2><p className="section-subtitle">Latest 100 activities.</p></div></div>
      {q.isLoading ? <div className="status">Loading activities…</div> : q.isError ? <div className="error-state">Activities failed to load.</div> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Title</th><th>Distance</th><th>Time</th><th>Pace</th><th>Elev</th><th>HR</th></tr></thead><tbody>{(q.data ?? []).map((a) => <tr key={a.id}><td>{formatDate(a.local_date)}</td><td><Link href={`/activities/${a.id}`}>{a.title}</Link></td><td>{formatDistance(a.source_distance_m ?? a.computed_distance_m)}</td><td>{formatDuration(a.moving_time_s)}</td><td>{formatPace(a.avg_pace_s_per_km)}</td><td>{formatElevation(a.elevation_gain_m)}</td><td>{a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}</td></tr>)}</tbody></table></div>
      )}
    </section>
  </main>;
}
