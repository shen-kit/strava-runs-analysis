export function formatDistance(m?: number | null) {
  if (m == null) return "—";
  return `${(m / 1000).toFixed(2)} km`;
}
export function formatDuration(s?: number | null) {
  if (s == null) return "—";
  const sec = Math.round(s); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const r = sec % 60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}` : `${m}:${String(r).padStart(2,"0")}`;
}
export function formatPace(s?: number | null) {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60); const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2,"0")} /km`;
}
export function formatElevation(m?: number | null) { return m == null ? "—" : `${Math.round(m)} m`; }
export function formatDate(v?: string | null) { return v ? new Date(v).toLocaleDateString() : "—"; }
