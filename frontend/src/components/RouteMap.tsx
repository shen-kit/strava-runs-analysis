"use client";
export function RouteMap({ points }: { points: [number, number, number | null][] }) {
  if (!points?.length) return <div className="rounded bg-slate-100 p-6 text-slate-500">No route. TODO: add OSM tiles.</div>;
  const lats = points.map(p => p[0]), lons = points.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const w = 800, h = 320, pad = 16;
  const xy = (p: [number, number, number | null]) => {
    const x = pad + ((p[1] - minLon) / Math.max(maxLon - minLon, 1e-9)) * (w - pad * 2);
    const y = h - pad - ((p[0] - minLat) / Math.max(maxLat - minLat, 1e-9)) * (h - pad * 2);
    return `${x},${y}`;
  };
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-80 w-full rounded bg-slate-100"><polyline points={points.map(xy).join(" ")} fill="none" stroke="#2563eb" strokeWidth="3"/><circle cx={xy(points[0]).split(',')[0]} cy={xy(points[0]).split(',')[1]} r="5" fill="#16a34a"/><circle cx={xy(points[points.length-1]).split(',')[0]} cy={xy(points[points.length-1]).split(',')[1]} r="5" fill="#dc2626"/></svg>;
}
