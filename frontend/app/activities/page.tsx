"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DragEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { ActivityActionsMenu } from "@/src/components/ActivityActionsMenu";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";

export default function ActivitiesPage() {
  const router = useRouter();
  const q = useQuery({ queryKey: ["activities", { limit: 100 }], queryFn: () => api.activities("limit=100") });
  const uploadZip = useMutation({ mutationFn: api.uploadZip, onSuccess: (r) => router.push(`/import?jobId=${r.id}`) });
  const uploadFiles = useMutation({ mutationFn: api.uploadActivityFiles, onSuccess: (r) => router.push(`/import?jobId=${r.id}`) });
  function droppedFiles(e: DragEvent) { e.preventDefault(); return Array.from(e.dataTransfer.files ?? []); }
  function dropZip(e: DragEvent) {
    const file = droppedFiles(e).find((f) => f.name.toLowerCase().endsWith(".zip"));
    if (file) uploadZip.mutate({ file });
  }
  function dropActivities(e: DragEvent) {
    const files = droppedFiles(e).filter((f) => /\.(gpx|tcx|fit)(\.gz)?$/i.test(f.name));
    if (files.length) uploadFiles.mutate(files);
  }
  return <main className="page-shell page-stack">
    <div className="page-header">
      <div><h1 className="page-title">Activities</h1><p className="page-subtitle">Recent imported runs with key training metrics.</p></div>
      <div className="toolbar import-toolbar">
        <Link href="/import" className="btn btn-primary import-drop" onDragOver={(e) => e.preventDefault()} onDrop={dropZip}>{uploadZip.isPending ? "Uploading ZIP…" : "Import ZIP"}</Link>
        <Link href="/import" className="btn import-drop" onDragOver={(e) => e.preventDefault()} onDrop={dropActivities}>{uploadFiles.isPending ? "Uploading files…" : "Import files"}</Link>
      </div>
    </div>
    {(uploadZip.error || uploadFiles.error) && <div className="error-state">{String(uploadZip.error ?? uploadFiles.error)}</div>}
    <section className="card">
      <div className="section-heading"><div><h2 className="section-title">Run history</h2><p className="section-subtitle">Latest 100 activities.</p></div></div>
      {q.isLoading ? <div className="status">Loading activities…</div> : q.isError ? <div className="error-state">Activities failed to load.</div> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Title</th><th>Distance</th><th>Time</th><th>Pace</th><th>Elev</th><th>HR</th><th className="actions-cell"><span className="sr-only">Actions</span></th></tr></thead><tbody>{(q.data ?? []).map((a) => <tr key={a.id}><td>{formatDate(a.local_date)}</td><td><Link href={`/activities/${a.id}`}>{a.title}</Link></td><td>{formatDistance(a.source_distance_m ?? a.computed_distance_m)}</td><td>{formatDuration(a.moving_time_s ?? a.elapsed_time_s)}</td><td>{formatPace(a.avg_pace_s_per_km)}</td><td>{formatElevation(a.elevation_gain_m)}</td><td>{a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}</td><td className="actions-cell"><ActivityActionsMenu activityId={a.id} title={a.title} /></td></tr>)}</tbody></table></div>
      )}
    </section>
  </main>;
}
