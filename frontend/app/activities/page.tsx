"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { api, type Activity } from "@/src/lib/api";
import { ActivityActionsMenu } from "@/src/components/ActivityActionsMenu";
import { formatDistance, formatDuration, formatElevation, formatPace, formatDate } from "@/src/lib/format";

type SortKey = "date" | "distance" | "time" | "pace";
type SortDirection = "asc" | "desc";
const PAGE_SIZE = 50;

export default function ActivitiesPage() {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["activities", { sort, direction, dateFrom, dateTo }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam), sort, direction });
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      return api.activities(p.toString());
    },
    getNextPageParam: (lastPage, allPages) => lastPage.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
  });
  const rows = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
    }, { rootMargin: "300px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]);

  const uploadZip = useMutation({ mutationFn: api.uploadZip, onSuccess: (r) => router.push(`/import?jobId=${r.id}`) });
  const uploadFiles = useMutation({ mutationFn: api.uploadActivityFiles, onSuccess: (r) => router.push(`/import?jobId=${r.id}`) });
  function droppedFiles(e: DragEvent) { e.preventDefault(); return Array.from(e.dataTransfer.files ?? []); }
  function dropZip(e: DragEvent) { const file = droppedFiles(e).find((f) => f.name.toLowerCase().endsWith(".zip")); if (file) uploadZip.mutate({ file }); }
  function dropActivities(e: DragEvent) { const files = droppedFiles(e).filter((f) => /\.(gpx|tcx|fit)(\.gz)?$/i.test(f.name)); if (files.length) uploadFiles.mutate(files); }
  function setSortKey(key: SortKey) {
    if (sort === key) setDirection((d) => d === "asc" ? "desc" : "asc");
    else { setSort(key); setDirection(key === "date" ? "desc" : "asc"); }
  }
  function setSortSelect(value: string) {
    const [key, dir] = value.split(":") as [SortKey, SortDirection];
    setSort(key); setDirection(dir);
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
      <div className="section-heading"><div><h2 className="section-title">Run history</h2><p className="section-subtitle">Scroll to load more activities.</p></div></div>
      <div className="toolbar mb-4">
        <label className="settings-field min-w-40"><span>From</span><input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="settings-field min-w-40"><span>To</span><input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <button className="btn self-end" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear filters</button>
      </div>
      {q.isLoading ? <div className="status">Loading activities…</div> : q.isError ? <div className="error-state">Activities failed to load.</div> : <>
        <div className="mobile-sortbar"><label className="settings-field"><span>Sort</span><select className="select" value={`${sort}:${direction}`} onChange={(e) => setSortSelect(e.target.value)}><option value="date:desc">Date newest</option><option value="date:asc">Date oldest</option><option value="distance:desc">Distance longest</option><option value="distance:asc">Distance shortest</option><option value="time:desc">Duration longest</option><option value="time:asc">Duration shortest</option><option value="pace:asc">Pace fastest</option><option value="pace:desc">Pace slowest</option></select></label></div>
        <div className="table-wrap responsive-table-desktop"><table className="table"><thead><tr><th><SortButton label="Date" column="date" sort={sort} direction={direction} onClick={setSortKey} /></th><th>Title</th><th><SortButton label="Distance" column="distance" sort={sort} direction={direction} onClick={setSortKey} /></th><th><SortButton label="Duration" column="time" sort={sort} direction={direction} onClick={setSortKey} /></th><th><SortButton label="Pace" column="pace" sort={sort} direction={direction} onClick={setSortKey} /></th><th>Elev</th><th>HR</th><th className="actions-cell"><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((a) => <ActivityRow key={a.id} activity={a} />)}</tbody></table></div>
        <div className="mobile-card-list">{rows.map((a) => <ActivityCard key={a.id} activity={a} />)}</div>
        <div ref={sentinelRef} className="status mt-4 text-center">{q.isFetchingNextPage ? "Loading more…" : q.hasNextPage ? "Scroll for more" : `All activities loaded (${rows.length})`}</div>
      </>}
    </section>
  </main>;
}

function SortButton({ label, column, sort, direction, onClick }: { label: string; column: SortKey; sort: SortKey; direction: SortDirection; onClick: (key: SortKey) => void }) {
  const active = sort === column;
  return <button className="table-sort" onClick={() => onClick(column)}>{label} {active ? (direction === "asc" ? "↑" : "↓") : ""}</button>;
}

function ActivityRow({ activity: a }: { activity: Activity }) {
  return <tr><td>{formatDate(a.local_date)}</td><td><Link href={`/activities/${a.id}`}>{a.title}</Link></td><td>{formatDistance(a.source_distance_m ?? a.computed_distance_m)}</td><td>{formatDuration(a.moving_time_s ?? a.elapsed_time_s)}</td><td>{formatPace(a.avg_pace_s_per_km)}</td><td>{formatElevation(a.elevation_gain_m)}</td><td>{a.avg_heart_rate_bpm ? Math.round(a.avg_heart_rate_bpm) : "—"}</td><td className="actions-cell"><ActivityActionsMenu activityId={a.id} title={a.title} /></td></tr>;
}
function ActivityCard({ activity: a }: { activity: Activity }) {
  return <article className="mobile-row-card"><div className="mobile-row-head"><div><Link href={`/activities/${a.id}`} className="mobile-row-title">{a.title}</Link><div className="mobile-row-subtitle">{formatDate(a.local_date)}</div></div><ActivityActionsMenu activityId={a.id} title={a.title} /></div><div className="mobile-row-metrics"><span><b>Distance</b>{formatDistance(a.source_distance_m ?? a.computed_distance_m)}</span><span><b>Duration</b>{formatDuration(a.moving_time_s ?? a.elapsed_time_s)}</span><span><b>Pace</b>{formatPace(a.avg_pace_s_per_km)}</span></div></article>;
}
