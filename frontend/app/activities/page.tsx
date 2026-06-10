"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";

export default function ActivitiesPage() {
  const q = useQuery({ queryKey: ["activities", { limit: 100 }], queryFn: () => api.activities("limit=100") });
  return <main className="mx-auto max-w-6xl space-y-4 p-4"><h1 className="text-3xl font-bold">Activities</h1><div className="card overflow-x-auto">
    {q.isLoading ? <p>Loading…</p> : <table className="table"><thead><tr><th>Date</th><th>Title</th><th>Distance</th><th>Time</th><th>Pace</th><th>Elev</th><th>HR</th></tr></thead><tbody>{(q.data ?? []).map((a) => <tr key={a.id}><td>{formatDate(a.local_date)}</td><td><Link href={`/activities/${a.id}`}>{a.title}</Link></td><td>{formatDistance(a.source_distance_m)}</td><td>{formatDuration(a.moving_time_s)}</td><td>{formatPace(a.avg_pace_s_per_km)}</td><td>{formatElevation(a.elevation_gain_m)}</td><td>{a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}</td></tr>)}</tbody></table>}
  </div></main>;
}
