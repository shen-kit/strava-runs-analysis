const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type Activity = {
  id: number; title: string; local_date: string; start_time_local?: string; source_distance_m?: number; computed_distance_m?: number;
  moving_time_s?: number; elapsed_time_s?: number; elevation_gain_m?: number; avg_pace_s_per_km?: number; avg_heart_rate_bpm?: number;
  avg_cadence_spm?: number; source_activity_id?: string; source_filename?: string;
};
export type ImportJob = { status: string; run_activities_seen: number; processed_count: number; new_count: number; skipped_count: number; reprocessed_count: number; failed_count: number; skipped_non_run_activities_count: number; error_message?: string | null };
export type Summary = { total_runs: number; total_distance_m: number; total_moving_time_s: number; total_elevation_gain_m: number; average_pace_s_per_km?: number | null; longest_run_distance_m: number; latest_activity_date?: string | null };
export type StatRow = Record<string, string | number | null>;
export type TotalRow = { bucket: string; run_count: number; distance_m: number; moving_time_s: number; elevation_gain_m: number };
export type PersonalBest = { distance_m: number; duration_s: number; pace_s_per_km: number; activity_id: number; activity_title: string; local_date: string };
export type RouteResponse = { simplified_points_json: [number, number, number | null][]; original_point_count: number; simplified_point_count: number; simplification_tolerance_m?: number | null };
export type StreamResponse = { streams: Record<string, [number, number][]> };
export type Split = { id: number; split_index: number; duration_s: number; avg_pace_s_per_km?: number | null; avg_heart_rate_bpm?: number | null };
export type BestEffort = { distance_m: number; duration_s: number; pace_s_per_km: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  summary: () => request<Summary>("/stats/summary"),
  totals: (bucket = "week") => request<TotalRow[]>(`/stats/totals?bucket=${bucket}`),
  paceTrend: (bucket = "week") => request<StatRow[]>(`/stats/pace-trend?bucket=${bucket}`),
  elevation: (bucket = "week") => request<StatRow[]>(`/stats/elevation?bucket=${bucket}`),
  personalBests: () => request<PersonalBest[]>("/stats/personal-bests"),
  activities: (params = "limit=50") => request<Activity[]>(`/activities?${params}`),
  activity: (id: number) => request<Activity>(`/activities/${id}`),
  route: (id: number) => request<RouteResponse>(`/activities/${id}/route`),
  splits: (id: number) => request<Split[]>(`/activities/${id}/splits`),
  bestEfforts: (id: number) => request<BestEffort[]>(`/activities/${id}/best-efforts`),
  streams: (id: number, types = "pace,heart_rate,cadence,elevation") => request<StreamResponse>(`/activities/${id}/streams?types=${types}`),
  uploadZip: async ({ file, forceReprocessAll = false, forceReprocessExtensions = [] }: { file: File; forceReprocessAll?: boolean; forceReprocessExtensions?: string[] }) => {
    const form = new FormData();
    form.append("file", file);
    form.append("force_reprocess_all", String(forceReprocessAll));
    form.append("force_reprocess_extensions", forceReprocessExtensions.join(","));
    return request<{id: number; status: string}>("/imports/strava-zip", { method: "POST", body: form });
  },
  importJob: (id: number) => request<ImportJob>(`/imports/${id}`),
};
