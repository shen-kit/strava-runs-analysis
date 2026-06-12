import type { FeatureCollection, Geometry } from "geojson";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type Activity = {
  id: number; title: string; local_date: string; start_time_local?: string; source_distance_m?: number; computed_distance_m?: number;
  moving_time_s?: number; elapsed_time_s?: number; elevation_gain_m?: number; avg_pace_s_per_km?: number; avg_heart_rate_bpm?: number;
  avg_cadence_spm?: number; source_activity_id?: string; source_filename?: string;
};
export type ImportDiagnostic = { source_filename?: string | null; parser_name?: string | null; parse_status: string; file_hash?: string | null; inferred_title?: string | null; inferred_start_time?: string | null; computed_distance_m?: number | null; computed_duration_s?: number | null; duplicate_reason?: string | null; warnings?: string[] | null; error_message?: string | null };
export type ImportJob = { id?: number; status: string; run_activities_seen: number; processed_count: number; new_count: number; skipped_count: number; reprocessed_count: number; failed_count: number; skipped_non_run_activities_count: number; error_message?: string | null; diagnostics?: ImportDiagnostic[]; created_at?: string; started_at?: string | null; completed_at?: string | null };
export type Summary = { total_runs: number; total_distance_m: number; total_moving_time_s: number; total_elevation_gain_m: number; average_pace_s_per_km?: number | null; longest_run_distance_m: number; latest_activity_date?: string | null; current_month_distance_m: number; current_year_distance_m: number };
export type StatRow = Record<string, string | number | null>;
export type TotalRow = { bucket: string; run_count: number; days_run?: number; distance_m: number; moving_time_s: number; elevation_gain_m: number; rolling_4_week_avg_distance_m?: number | null };
export type DashboardSectionKey = "summary" | "weeklyVolume" | "trainingConsistency" | "personalBests" | "bestEffortTrend" | "longRun" | "paceTrend" | "elevationTrend" | "distanceDistribution" | "recentRuns";
export type AppSettings = {
  dashboard: { visibleSections: Record<DashboardSectionKey, boolean>; sectionOrder: DashboardSectionKey[]; defaultTimeRange: string; defaultBucket: "week" | "month" | "year" };
  maps: { defaultOverlay: "none" | RouteOverlayMetric; defaultMapType: "satellite" | "street" };
  charts: { paceSmoothingWindowM: number; elevationSmoothingWindowM: number; gradientSmoothingWindowM: number };
  trainingZones: { heartRate: Zone[]; pace: Zone[] };
};
export type Zone = { label: string; min: number; max: number };
export type BestEffortDistanceSetting = { id?: number; label: string; distance_m: number; enabled: boolean; sort_order: number };
export type PersonalBest = { distance_m: number; label?: string; duration_s: number; pace_s_per_km: number; activity_id: number; activity_title: string; local_date: string };
export type RouteResponse = { simplified_points_json: [number, number, number | null][]; original_point_count: number; simplified_point_count: number; simplification_tolerance_m?: number | null };
export type StreamResponse = { x_domain_m: [number, number]; streams: Record<string, [number, number | null][]>; pauses?: { start_distance_m: number; end_distance_m: number; duration_s: number }[] };
export type RouteOverlayMetric = "pace" | "heart_rate" | "gradient" | "cadence";
export type RouteOverlayResponse = { metric: RouteOverlayMetric; unit: string; min_value?: number | null; max_value?: number | null; has_heart_rate: boolean; has_cadence: boolean; markers: {type: "start" | "finish" | "pause"; coordinates: [number, number]; gap_s?: number}[]; paused_geojson?: FeatureCollection<Geometry>; geojson: FeatureCollection<Geometry> };
export type Split = { id: number; split_index: number; duration_s: number; avg_pace_s_per_km?: number | null; avg_heart_rate_bpm?: number | null };
export type BestEffort = { distance_m: number; duration_s: number; pace_s_per_km: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  settings: () => request<AppSettings>("/settings"),
  updateSettings: (settings: AppSettings) => request<AppSettings>("/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) }),
  bestEffortDistances: () => request<BestEffortDistanceSetting[]>("/settings/best-effort-distances"),
  updateBestEffortDistances: (distances: BestEffortDistanceSetting[]) => request<BestEffortDistanceSetting[]>("/settings/best-effort-distances", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ distances }) }),
  recalculateBestEfforts: () => request<{status: string; efforts: number; distances: number}>("/settings/best-effort-distances/recalculate", { method: "POST" }),
  summary: () => request<Summary>("/stats/summary"),
  totals: (bucket = "week") => request<TotalRow[]>(`/stats/totals?bucket=${bucket}`),
  weeklyVolume: () => request<TotalRow[]>("/stats/weekly-volume"),
  consistency: () => request<{weeks: TotalRow[]; current_week_count: number; average_runs_per_week: number}>("/stats/consistency"),
  paceTrend: (bucket = "week") => request<StatRow[]>(`/stats/pace-trend?bucket=${bucket}`),
  elevation: (bucket = "week") => request<StatRow[]>(`/stats/elevation?bucket=${bucket}`),
  personalBests: () => request<PersonalBest[]>("/stats/personal-bests"),
  bestEffortTrend: (distances = "1000,5000,10000") => request<StatRow[]>(`/stats/best-effort-trend?distances=${distances}`),
  longRunProgression: (bucket = "week") => request<StatRow[]>(`/stats/long-run-progression?bucket=${bucket}`),
  distanceDistribution: () => request<StatRow[]>("/stats/distance-distribution"),
  activities: (params = "limit=50") => request<Activity[]>(`/activities?${params}`),
  activity: (id: number) => request<Activity>(`/activities/${id}`),
  deleteActivity: (id: number) => request<{status: string; activity_id: number}>(`/activities/${id}`, { method: "DELETE" }),
  reprocessActivity: (id: number) => request<Activity>(`/activities/${id}/reprocess`, { method: "POST" }),
  route: (id: number) => request<RouteResponse>(`/activities/${id}/route`),
  routeOverlay: (id: number, metric: RouteOverlayMetric) => request<RouteOverlayResponse>(`/activities/${id}/route-overlay?metric=${metric}`),
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
  uploadActivityFiles: async (files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request<{id: number; status: string}>("/imports/activity-files", { method: "POST", body: form });
  },
  importJobs: (limit = 10) => request<ImportJob[]>(`/imports?limit=${limit}`),
  importJob: (id: number) => request<ImportJob>(`/imports/${id}`),
};
