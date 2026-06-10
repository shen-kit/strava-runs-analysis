"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, CartesianGrid } from "recharts";

export function DistanceBar({ data }: { data: Array<Record<string, string | number | null>> }) {
  return <div className="h-72"><ResponsiveContainer><BarChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket"/><YAxis/><Tooltip/><Bar dataKey="distance_km" fill="#2563eb"/></BarChart></ResponsiveContainer></div>;
}
export function StreamLine({ data, yKey, name }: { data: Array<Record<string, string | number | null>>; yKey: string; name: string }) {
  return <div className="h-56"><ResponsiveContainer><LineChart data={data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="km"/><YAxis/><Tooltip/><Line dot={false} type="monotone" dataKey={yKey} name={name} stroke="#16a34a"/></LineChart></ResponsiveContainer></div>;
}
