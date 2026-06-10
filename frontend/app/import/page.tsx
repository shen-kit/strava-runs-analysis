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
  return <main className="mx-auto max-w-3xl space-y-6 p-4"><h1 className="text-3xl font-bold">Import Strava ZIP</h1>
    <form onSubmit={submit} className="card space-y-4">
      <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <fieldset className="space-y-2"><legend className="font-semibold">Reprocessing</legend>
        <label className="block"><input className="mr-2" type="radio" name="forceMode" checked={forceMode === "none"} onChange={() => setForceMode("none")} />Use dedupe normally</label>
        <label className="block"><input className="mr-2" type="radio" name="forceMode" checked={forceMode === "all"} onChange={() => setForceMode("all")} />Force re-process all activities</label>
        <label className="block"><input className="mr-2" type="radio" name="forceMode" checked={forceMode === "extensions"} onChange={() => setForceMode("extensions")} />Force re-process selected file extensions</label>
      </fieldset>
      {forceMode === "extensions" && <div className="rounded border border-slate-200 p-3"><div className="mb-2 text-sm text-slate-600">Applies to each extension plus compressed variants, e.g. GPX and GPX.GZ.</div>{["gpx", "fit", "tcx"].map((ext) => <label key={ext} className="mr-4 inline-block"><input className="mr-2" type="checkbox" checked={extensions.includes(ext)} onChange={() => toggleExtension(ext)} />{ext.toUpperCase()}</label>)}</div>}
      <button className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={!file || upload.isPending || (forceMode === "extensions" && extensions.length === 0)}>{upload.isPending ? "Uploading…" : "Upload"}</button>{upload.error && <p className="text-red-700">{String(upload.error)}</p>}
    </form>
    {jobId && <section className="card"><h2 className="mb-3 text-xl font-semibold">Import job #{jobId}</h2>{job.isLoading ? <p>Loading…</p> : <table className="table"><tbody>{rows.map(([k,v]) => <tr key={k}><th>{k}</th><td>{String(v)}</td></tr>)}</tbody></table>}{job.data?.error_message && <p className="mt-3 text-red-700">{job.data.error_message}</p>}</section>}
  </main>;
}
