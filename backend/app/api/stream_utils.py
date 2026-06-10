from __future__ import annotations
from dataclasses import dataclass
from statistics import median
from typing import Iterable
from ..importer.derive import MAX_RUNNING_SPEED_MPS, haversine_m


@dataclass
class StreamPoint:
    distance_m: float | None
    elapsed_time_s: float | None
    lat: float | None
    lon: float | None
    elevation_m: float | None
    heart_rate_bpm: float | None
    cadence_spm: float | None


def with_cumulative_distance(rows: Iterable) -> list[StreamPoint]:
    out: list[StreamPoint] = []
    dist = 0.0
    prev_gps = None
    for p in rows:
        source = p.distance_m
        if source is not None and source >= 0 and source >= dist:
            dist = float(source)
        elif prev_gps and p.lat is not None and p.lon is not None and prev_gps.lat is not None and prev_gps.lon is not None:
            dist += haversine_m(prev_gps.lat, prev_gps.lon, p.lat, p.lon)
        d = dist if (source is not None or p.lat is not None and p.lon is not None) else None
        sp = StreamPoint(d, p.elapsed_time_s, p.lat, p.lon, p.elevation_m, p.heart_rate_bpm, p.cadence_spm)
        out.append(sp)
        if p.lat is not None and p.lon is not None:
            prev_gps = p
    return out


def _interp_elapsed(points: list[StreamPoint], target_d: float) -> float | None:
    prev = None
    for p in points:
        if p.distance_m is None or p.elapsed_time_s is None:
            continue
        if p.distance_m == target_d:
            return p.elapsed_time_s
        if prev and prev.distance_m is not None and prev.elapsed_time_s is not None and prev.distance_m <= target_d <= p.distance_m and p.distance_m > prev.distance_m:
            f = (target_d - prev.distance_m) / (p.distance_m - prev.distance_m)
            return prev.elapsed_time_s + (p.elapsed_time_s - prev.elapsed_time_s) * f
        prev = p
    return None


def smoothed_pace_stream(points: list[StreamPoint], window_m: float = 50.0) -> list[list[float]]:
    valid = [p for p in points if p.distance_m is not None and p.elapsed_time_s is not None]
    if len(valid) < 3:
        return []
    out: list[list[float]] = []
    half = window_m / 2
    min_d, max_d = valid[0].distance_m or 0, valid[-1].distance_m or 0
    for p in valid:
        d = p.distance_m
        if d is None or d - half < min_d or d + half > max_d:
            continue
        t1 = _interp_elapsed(valid, d - half); t2 = _interp_elapsed(valid, d + half)
        if t1 is None or t2 is None:
            continue
        dt = t2 - t1
        if dt <= 0:
            continue
        speed = window_m / dt
        if speed <= 0 or speed > MAX_RUNNING_SPEED_MPS:
            continue
        out.append([d, dt / (window_m / 1000.0)])
    return out


def smoothed_elevation_stream(points: list[StreamPoint], window_m: float = 50.0) -> list[list[float]]:
    valid = [p for p in points if p.distance_m is not None and p.elevation_m is not None]
    if len(valid) < 2:
        return []
    out: list[list[float]] = []
    half = window_m / 2
    for p in valid:
        d = p.distance_m
        if d is None:
            continue
        vals = [q.elevation_m for q in valid if q.distance_m is not None and abs(q.distance_m - d) <= half and q.elevation_m is not None]
        if vals:
            out.append([d, float(median(vals))])
    return out


def sensor_stream(points: list[StreamPoint], attr: str) -> list[list[float]]:
    out = []
    for p in points:
        d = p.distance_m
        v = getattr(p, attr)
        if d is not None and v is not None:
            out.append([d, float(v)])
    return out


def build_streams(rows: Iterable, wanted: set[str]) -> dict[str, list[list[float]]]:
    points = with_cumulative_distance(rows)
    streams: dict[str, list[list[float]]] = {}
    if "pace" in wanted:
        streams["pace"] = smoothed_pace_stream(points)
    if "elevation" in wanted:
        streams["elevation"] = smoothed_elevation_stream(points)
    if "heart_rate" in wanted:
        streams["heart_rate"] = sensor_stream(points, "heart_rate_bpm")
    if "cadence" in wanted:
        streams["cadence"] = sensor_stream(points, "cadence_spm")
    return streams


def downsample_streams(streams: dict[str, list[list[float]]]) -> dict[str, list[list[float]]]:
    return streams
