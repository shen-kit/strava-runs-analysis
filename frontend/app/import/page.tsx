"use client";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [forceMode, setForceMode] = useState<"none" | "all" | "extensions">("none");
  const [extensions, setExtensions] = useState<string[]>([]);
  const qc = useQueryClient();
  const upload = useMutation({ mutationFn: api.uploadZip, onSuccess: (r) => setJobId(r.id) });
  const job = useQuery({ queryKey: ["import", jobId], queryFn: () => api.importJob(jobId!), enabled: jobId != null, refetchInterval: (q) => {
    const s = q.state.data?.status; return s === "pending" || s === "processing" ? 3000 : false;
  }});
  const status = job.data?.status;
  useEffect(() => { if (status === "completed") { qc.invalidateQueries({ queryKey: ["stats"] }); qc.invalidateQueries({ queryKey: ["activities"] }); } }, [status, qc]);
  function toggleExtension(ext: string) {
    setExtensions((xs) => xs.includes(ext) ? xs.filter((x) => x !== ext) : [...xs, ext]);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (file) upload.mutate({ file, forceReprocessAll: forceMode === "all", forceReprocessExtensions: forceMode === "extensions" ? extensions : [] });
  }
  const rows = job.data ? Object.entries(job.data).filter(([k]) => k !== "error_message") : [];
  return <main className="page-shell-narrow page-stack">
    <div className="page-header">
      <div>
        <h1 className="page-title">Import Strava ZIP</h1>
        <p className="page-subtitle">Upload an export archive to refresh activities and dashboard metrics.</p>
      </div>
    </div>

    <form onSubmit={submit} className="card space-y-4">
      <div>
        <label className="metric-label mb-2 block" htmlFor="zip-file">Archive file</label>
        <input id="zip-file" type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <fieldset className="fieldset space-y-2"><legend className="px-1 text-sm font-semibold">Reprocessing</legend>
        <label className="choice"><input type="radio" name="forceMode" checked={forceMode === "none"} onChange={() => setForceMode("none")} />Use dedupe normally</label>
        <label className="choice"><input type="radio" name="forceMode" checked={forceMode === "all"} onChange={() => setForceMode("all")} />Force re-process all activities</label>
        <label className="choice"><input type="radio" name="forceMode" checked={forceMode === "extensions"} onChange={() => setForceMode("extensions")} />Force re-process selected file extensions</label>
      </fieldset>
      {forceMode === "extensions" && <div className="fieldset"><div className="mb-3 text-sm muted">Applies to each extension plus compressed variants, e.g. GPX and GPX.GZ.</div>{["gpx", "fit", "tcx"].map((ext) => <label key={ext} className="choice mr-4 inline-flex"><input type="checkbox" checked={extensions.includes(ext)} onChange={() => toggleExtension(ext)} />{ext.toUpperCase()}</label>)}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={!file || upload.isPending || (forceMode === "extensions" && extensions.length === 0)}>{upload.isPending ? "Uploading…" : "Upload"}</button>
        {upload.error && <p className="error-state flex-1">{String(upload.error)}</p>}
      </div>
    </form>

    {jobId && <section className="card">
      <div className="section-heading"><div><h2 className="section-title">Import job #{jobId}</h2><p className="section-subtitle">Status updates automatically while job runs.</p></div></div>
      {job.isLoading ? <div className="status">Loading import job…</div> : <div className="table-wrap"><table className="table"><tbody>{rows.map(([k,v]) => <tr key={k}><th>{k}</th><td>{String(v)}</td></tr>)}</tbody></table></div>}
      {job.data?.error_message && <p className="error-state mt-3">{job.data.error_message}</p>}
    </section>}
  </main>;
}
