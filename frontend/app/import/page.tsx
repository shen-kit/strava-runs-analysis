"use client";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ImportDiagnostic } from "@/src/lib/api";
import { formatDistance, formatDuration, formatDate } from "@/src/lib/format";

export default function ImportPage() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [activityFiles, setActivityFiles] = useState<File[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [forceMode, setForceMode] = useState<"none" | "all" | "extensions">("none");
  const [extensions, setExtensions] = useState<string[]>([]);
  const qc = useQueryClient();
  const uploadZip = useMutation({ mutationFn: api.uploadZip, onSuccess: (r) => setJobId(r.id) });
  const uploadFiles = useMutation({ mutationFn: api.uploadActivityFiles, onSuccess: (r) => setJobId(r.id) });
  const job = useQuery({ queryKey: ["import", jobId], queryFn: () => api.importJob(jobId!), enabled: jobId != null, refetchInterval: (q) => {
    const s = q.state.data?.status; return s === "pending" || s === "processing" ? 3000 : false;
  }});
  const status = job.data?.status;
  useEffect(() => { if (status === "completed") { qc.invalidateQueries({ queryKey: ["stats"] }); qc.invalidateQueries({ queryKey: ["activities"] }); } }, [status, qc]);
  function toggleExtension(ext: string) { setExtensions((xs) => xs.includes(ext) ? xs.filter((x) => x !== ext) : [...xs, ext]); }
  function submitZip(e: FormEvent) {
    e.preventDefault();
    if (zipFile) uploadZip.mutate({ file: zipFile, forceReprocessAll: forceMode === "all", forceReprocessExtensions: forceMode === "extensions" ? extensions : [] });
  }
  function submitFiles(e: FormEvent) {
    e.preventDefault();
    if (activityFiles.length) uploadFiles.mutate(activityFiles);
  }
  const rows = job.data ? Object.entries(job.data).filter(([k]) => !["error_message", "diagnostics"].includes(k)) : [];
  return <main className="page-shell-narrow page-stack">
    <div className="page-header"><div><h1 className="page-title">Import activities</h1><p className="page-subtitle">Upload a Strava export ZIP or individual GPX, TCX, FIT activity files.</p></div></div>

    <section className="card page-stack">
      <div className="section-heading"><div><h2 className="section-title">Upload Strava ZIP</h2><p className="section-subtitle">Import a full Strava export archive.</p></div></div>
      <form onSubmit={submitZip} className="space-y-4">
        <div><label className="metric-label mb-2 block" htmlFor="zip-file">Archive file</label><input id="zip-file" type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] ?? null)} /></div>
        <fieldset className="fieldset space-y-2"><legend className="px-1 text-sm font-semibold">Reprocessing</legend>
          <label className="choice"><input type="radio" name="forceMode" checked={forceMode === "none"} onChange={() => setForceMode("none")} />Use dedupe normally</label>
          <label className="choice"><input type="radio" name="forceMode" checked={forceMode === "all"} onChange={() => setForceMode("all")} />Force re-process all activities</label>
          <label className="choice"><input type="radio" name="forceMode" checked={forceMode === "extensions"} onChange={() => setForceMode("extensions")} />Force re-process selected file extensions</label>
        </fieldset>
        {forceMode === "extensions" && <div className="fieldset"><div className="mb-3 text-sm muted">Applies to each extension plus compressed variants, e.g. GPX and GPX.GZ.</div>{["gpx", "fit", "tcx"].map((ext) => <label key={ext} className="choice mr-4 inline-flex"><input type="checkbox" checked={extensions.includes(ext)} onChange={() => toggleExtension(ext)} />{ext.toUpperCase()}</label>)}</div>}
        <div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary" disabled={!zipFile || uploadZip.isPending || (forceMode === "extensions" && extensions.length === 0)}>{uploadZip.isPending ? "Uploading…" : "Upload ZIP"}</button>{uploadZip.error && <p className="error-state flex-1">{String(uploadZip.error)}</p>}</div>
      </form>
    </section>

    <section className="card page-stack">
      <div className="section-heading"><div><h2 className="section-title">Upload individual activity files</h2><p className="section-subtitle">Supports .gpx, .tcx, .fit and .gz compressed variants. Multiple files allowed.</p></div></div>
      <form onSubmit={submitFiles} className="space-y-4">
        <div><label className="metric-label mb-2 block" htmlFor="activity-files">Activity files</label><input id="activity-files" type="file" multiple accept=".gpx,.tcx,.fit,.gpx.gz,.tcx.gz,.fit.gz" onChange={(e) => setActivityFiles(Array.from(e.target.files ?? []))} /></div>
        {!!activityFiles.length && <div className="status">Selected {activityFiles.length} file{activityFiles.length === 1 ? "" : "s"}: {activityFiles.map((f) => f.name).join(", ")}</div>}
        <div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary" disabled={!activityFiles.length || uploadFiles.isPending}>{uploadFiles.isPending ? "Uploading…" : "Upload activity files"}</button>{uploadFiles.error && <p className="error-state flex-1">{String(uploadFiles.error)}</p>}</div>
      </form>
    </section>

    {jobId && <section className="card">
      <div className="section-heading"><div><h2 className="section-title">Import job #{jobId}</h2><p className="section-subtitle">Status updates automatically while job runs.</p></div></div>
      {job.isLoading ? <div className="status">Loading import job…</div> : <div className="table-wrap"><table className="table"><tbody>{rows.map(([k,v]) => <tr key={k}><th>{k}</th><td>{String(v)}</td></tr>)}</tbody></table></div>}
      {job.data?.error_message && <p className="error-state mt-3">{job.data.error_message}</p>}
      {!!job.data?.diagnostics?.length && <Diagnostics rows={job.data.diagnostics} />}
    </section>}
  </main>;
}

function Diagnostics({ rows }: { rows: ImportDiagnostic[] }) {
  return <div className="mt-4 table-wrap"><table className="table"><thead><tr><th>File</th><th>Status</th><th>Title</th><th>Start</th><th>Distance</th><th>Duration</th><th>Duplicate / error</th></tr></thead><tbody>{rows.map((d, i) => <tr key={`${d.source_filename}-${i}`}><td>{d.source_filename ?? "—"}</td><td>{d.parse_status}</td><td>{d.inferred_title ?? "—"}</td><td>{d.inferred_start_time ? formatDate(d.inferred_start_time.slice(0, 10)) : "—"}</td><td>{formatDistance(d.computed_distance_m)}</td><td>{formatDuration(d.computed_duration_s)}</td><td>{d.duplicate_reason ?? d.error_message ?? d.warnings?.join(", ") ?? "—"}</td></tr>)}</tbody></table></div>;
}
