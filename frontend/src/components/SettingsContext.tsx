"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AppSettings, type BestEffortDistanceSetting, type DashboardSectionKey, type Zone } from "@/src/lib/api";

const sectionLabels: Record<DashboardSectionKey, string> = {
  summary: "Summary cards",
  weeklyVolume: "Weekly volume",
  trainingConsistency: "Training consistency",
  personalBests: "Personal bests",
  bestEffortTrend: "Best-effort trend",
  longRun: "Long run progression",
  paceTrend: "Pace trend",
  elevationTrend: "Elevation trend",
  distanceDistribution: "Distance distribution",
  recentRuns: "Recent runs",
};
const sectionKeys = Object.keys(sectionLabels) as DashboardSectionKey[];

const fallbackSettings: AppSettings = {
  dashboard: { visibleSections: Object.fromEntries(sectionKeys.map((k) => [k, true])) as Record<DashboardSectionKey, boolean>, sectionOrder: sectionKeys, defaultTimeRange: "6mo", defaultBucket: "week" },
  maps: { defaultOverlay: "none", defaultMapType: "satellite" },
  charts: { paceSmoothingWindowM: 500, elevationSmoothingWindowM: 100, gradientSmoothingWindowM: 100 },
  trainingZones: { heartRate: [], pace: [] },
};

function normalizeHeartZones(zones: Zone[]) {
  return zones.map((zone, index, all) => ({ ...zone, min: index === 0 ? 0 : Number(all[index - 1].max) + 1 }));
}

function normalizePaceZones(zones: Zone[]) {
  return zones.map((zone, index, all) => ({ ...zone, max: index === 0 ? zone.max : Number(all[index - 1].min) }));
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return { ...settings, trainingZones: { heartRate: normalizeHeartZones(settings.trainingZones.heartRate ?? []), pace: normalizePaceZones(settings.trainingZones.pace ?? []) } };
}

function secondsToPace(seconds: number) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function paceToSeconds(value: string) {
  const match = value.trim().match(/^(\d+):([0-5]?\d)$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type SettingsContextValue = {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  distances: BestEffortDistanceSetting[];
  setDistances: (distances: BestEffortDistanceSetting[]) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  loading: boolean;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [distances, setDistances] = useState<BestEffortDistanceSetting[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const distancesQuery = useQuery({ queryKey: ["settings", "best-effort-distances"], queryFn: api.bestEffortDistances });

  useEffect(() => { if (settingsQuery.data) setSettings(normalizeSettings(settingsQuery.data)); }, [settingsQuery.data]);
  useEffect(() => { if (distancesQuery.data) setDistances(distancesQuery.data.map((d) => ({ ...d, enabled: true }))); }, [distancesQuery.data]);

  const value = useMemo(() => ({ settings, setSettings, distances, setDistances, isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false), loading: settingsQuery.isLoading || distancesQuery.isLoading }), [settings, distances, isOpen, settingsQuery.isLoading, distancesQuery.isLoading]);
  return <SettingsContext.Provider value={value}>{children}<SettingsSidebar /></SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

function SettingsSidebar() {
  const { isOpen, close, settings, setSettings, distances, setDistances, loading } = useSettings();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const [savedSettings, savedDistances] = await Promise.all([api.updateSettings(normalizeSettings(settings)), api.updateBestEffortDistances(distances.map((d, i) => ({ ...d, enabled: true, sort_order: i })))]);
      return { savedSettings, savedDistances };
    },
    onSuccess: ({ savedSettings, savedDistances }) => {
      setSettings(normalizeSettings(savedSettings));
      setDistances(savedDistances.map((d) => ({ ...d, enabled: true })));
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["settings", "best-effort-distances"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
  const recalc = useMutation({ mutationFn: api.recalculateBestEfforts, onSuccess: () => { qc.invalidateQueries({ queryKey: ["stats"] }); qc.invalidateQueries({ queryKey: ["activity"] }); } });
  if (!isOpen) return null;

  const update = (next: AppSettings) => setSettings(normalizeSettings(next));
  const setSection = (key: DashboardSectionKey, value: boolean) => update({ ...settings, dashboard: { ...settings.dashboard, visibleSections: { ...settings.dashboard.visibleSections, [key]: value } } });
  const setZone = (kind: keyof AppSettings["trainingZones"], index: number, patch: Partial<Zone>) => update({ ...settings, trainingZones: { ...settings.trainingZones, [kind]: settings.trainingZones[kind].map((z, i) => i === index ? { ...z, ...patch } : z) } });
  const addZone = (kind: keyof AppSettings["trainingZones"]) => update({ ...settings, trainingZones: { ...settings.trainingZones, [kind]: [...settings.trainingZones[kind], { label: "New zone", min: 0, max: 0 }] } });
  const removeZone = (kind: keyof AppSettings["trainingZones"], index: number) => update({ ...settings, trainingZones: { ...settings.trainingZones, [kind]: settings.trainingZones[kind].filter((_, i) => i !== index) } });

  return <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
    <button className="settings-scrim" aria-label="Close settings" onClick={close} />
    <aside className="settings-panel">
      <div className="settings-header"><div><h2 className="section-title">Settings</h2><p className="section-subtitle">Edit live, save to DB.</p></div><button className="btn btn-sm" onClick={close}>Close</button></div>
      {loading && <div className="status">Loading settings…</div>}
      {save.isError && <div className="error-state">Save failed: {String(save.error)}</div>}
      {recalc.isError && <div className="error-state">Recalculate failed: {String(recalc.error)}</div>}
      {save.isSuccess && <div className="status">Settings saved.</div>}

      <SettingsGroup title="Dashboard">
        <div className="settings-grid-2"><label className="settings-field"><span>Default bucket</span><select className="select" value={settings.dashboard.defaultBucket} onChange={(e) => update({ ...settings, dashboard: { ...settings.dashboard, defaultBucket: e.target.value as AppSettings["dashboard"]["defaultBucket"] } })}><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option></select></label><label className="settings-field"><span>Default range</span><select className="select" value={settings.dashboard.defaultTimeRange} onChange={(e) => update({ ...settings, dashboard: { ...settings.dashboard, defaultTimeRange: e.target.value } })}><option value="3mo">3 months</option><option value="6mo">6 months</option><option value="1y">1 year</option><option value="2y">2 years</option><option value="5y">5 years</option></select></label></div>
        <div className="settings-list">{sectionKeys.map((key) => <label key={key} className="choice"><input type="checkbox" checked={settings.dashboard.visibleSections[key] ?? true} onChange={(e) => setSection(key, e.target.checked)} />{sectionLabels[key]}</label>)}</div>
      </SettingsGroup>

      <SettingsGroup title="Best efforts">
        <div className="settings-list"><div className="settings-row settings-row-best settings-table-head"><span>Label</span><span>Distance (m)</span><span className="settings-action-spacer">Delete</span></div>{distances.map((d, index) => <div className="settings-row settings-row-best" key={d.id ?? `new-${index}`}><input className="input" value={d.label} onChange={(e) => setDistances(distances.map((x, i) => i === index ? { ...x, label: e.target.value, enabled: true } : x))} /><input className="input" type="number" min="1" value={d.distance_m} onChange={(e) => setDistances(distances.map((x, i) => i === index ? { ...x, distance_m: Number(e.target.value), enabled: true } : x))} /><button className="btn btn-sm" onClick={() => setDistances(distances.filter((_, i) => i !== index))}>Delete</button></div>)}</div>
        <div className="toolbar"><button className="btn btn-sm" onClick={() => setDistances([...distances, { label: "New", distance_m: 1000, enabled: true, sort_order: distances.length }])}>Add distance</button><button className="btn btn-sm" disabled={recalc.isPending} onClick={() => recalc.mutate()}>{recalc.isPending ? "Recalculating…" : "Recalculate"}</button>{recalc.data && <span className="muted text-sm">{recalc.data.efforts} efforts</span>}</div>
      </SettingsGroup>

      <SettingsGroup title="Charts">
        <NumberField label="Pace smoothing (m)" value={settings.charts.paceSmoothingWindowM} onChange={(v) => update({ ...settings, charts: { ...settings.charts, paceSmoothingWindowM: v } })} />
        <NumberField label="Elevation smoothing (m)" value={settings.charts.elevationSmoothingWindowM} onChange={(v) => update({ ...settings, charts: { ...settings.charts, elevationSmoothingWindowM: v } })} />
        <NumberField label="Gradient smoothing (m)" value={settings.charts.gradientSmoothingWindowM} onChange={(v) => update({ ...settings, charts: { ...settings.charts, gradientSmoothingWindowM: v } })} />
      </SettingsGroup>

      <SettingsGroup title="Training zones">
        <HeartRateZoneEditor zones={settings.trainingZones.heartRate} onAdd={() => addZone("heartRate")} onRemove={(i) => removeZone("heartRate", i)} onChange={(i, p) => setZone("heartRate", i, p)} />
        <PaceZoneEditor zones={settings.trainingZones.pace} onAdd={() => addZone("pace")} onRemove={(i) => removeZone("pace", i)} onChange={(i, p) => setZone("pace", i, p)} />
      </SettingsGroup>

      <SettingsGroup title="Maps">
        <div className="settings-grid-2"><label className="settings-field"><span>Default map type</span><select className="select" value={settings.maps.defaultMapType} onChange={(e) => update({ ...settings, maps: { ...settings.maps, defaultMapType: e.target.value as "satellite" | "street" } })}><option value="satellite">Satellite</option><option value="street">Streets</option></select></label><label className="settings-field"><span>Default overlay</span><select className="select" value={settings.maps.defaultOverlay} onChange={(e) => update({ ...settings, maps: { ...settings.maps, defaultOverlay: e.target.value as AppSettings["maps"]["defaultOverlay"] } })}><option value="none">None</option><option value="pace">Pace</option><option value="heart_rate">Heart rate</option><option value="gradient">Hill gradient</option><option value="cadence">Cadence</option></select></label></div>
      </SettingsGroup>

      <div className="settings-footer"><button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save settings"}</button></div>
    </aside>
  </div>;
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section className="settings-group"><h3>{title}</h3>{children}</section>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="settings-field"><span>{label}</span><input className="input" type="number" min="0" value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>; }
function HeartRateZoneEditor({ zones, onAdd, onRemove, onChange }: { zones: Zone[]; onAdd: () => void; onRemove: (index: number) => void; onChange: (index: number, patch: Partial<Zone>) => void }) { return <div className="settings-zone"><div className="settings-zone-title"><b>Heart rate zones</b><button className="btn btn-sm" onClick={onAdd}>Add</button></div><div className="settings-row settings-row-zone settings-table-head"><span>Zone</span><span>Min (bpm)</span><span>Max (bpm)</span><span className="settings-action-spacer">Delete</span></div>{normalizeHeartZones(zones).map((z, i) => <div className="settings-row settings-row-zone" key={`heart-${i}`}><input className="input zone-name" value={z.label} onChange={(e) => onChange(i, { label: e.target.value })} /><input className="input zone-value" value={`${z.min}–`} readOnly aria-label="Calculated minimum" /><input className="input zone-value" type="number" value={z.max} aria-label="Maximum heart rate" onChange={(e) => onChange(i, { max: Number(e.target.value) })} /><button className="btn btn-sm" onClick={() => onRemove(i)}>Delete</button></div>)}</div>; }
function PaceZoneEditor({ zones, onAdd, onRemove, onChange }: { zones: Zone[]; onAdd: () => void; onRemove: (index: number) => void; onChange: (index: number, patch: Partial<Zone>) => void }) { const normalized = normalizePaceZones(zones); return <div className="settings-zone"><div className="settings-zone-title"><b>Pace zones</b><button className="btn btn-sm" onClick={onAdd}>Add</button></div><div className="settings-row settings-row-zone settings-table-head"><span>Zone</span><span>Min (min/km)</span><span>Max (min/km)</span><span className="settings-action-spacer">Delete</span></div>{normalized.map((z, i) => <div className="settings-row settings-row-zone" key={`pace-${i}`}><input className="input zone-name" value={z.label} onChange={(e) => onChange(i, { label: e.target.value })} /><PaceInput seconds={z.min} ariaLabel="Minimum pace" onCommit={(value) => onChange(i, { min: value })} /><input className="input zone-value" value={secondsToPace(z.max)} readOnly aria-label="Calculated maximum pace" /><button className="btn btn-sm" onClick={() => onRemove(i)}>Delete</button></div>)}</div>; }
function PaceInput({ seconds, ariaLabel, onCommit }: { seconds: number; ariaLabel: string; onCommit: (seconds: number) => void }) { const [value, setValue] = useState(secondsToPace(seconds)); useEffect(() => setValue(secondsToPace(seconds)), [seconds]); return <input className="input zone-value" value={value} aria-label={ariaLabel} onChange={(e) => setValue(e.target.value)} onBlur={() => { const next = paceToSeconds(value); setValue(secondsToPace(next)); onCommit(next); }} />; }
