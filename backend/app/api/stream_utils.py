from __future__ import annotations
from dataclasses import dataclass
from statistics import median
from typing import Iterable
from ..importer.derive import MAX_RUNNING_SPEED_MPS, haversine_m

Stream = list[list[float | None]]


@dataclass
class StreamPoint:
    distance_m: float | None
    elapsed_time_s: float | None
    lat: float | None
    lon: float | None
    elevation_m: float | None
    heart_rate_bpm: float | None
    cadence_spm: float | None


def valid_elevation(v: float | None) -> float | None:
    if v is None or v == -1:
        return None
    return float(v)


def _fill_missing_stream_distances_by_time(points: list[StreamPoint]) -> None:
    anchors = [
        p for p in points if p.elapsed_time_s is not None and p.distance_m is not None
    ]
    if not anchors:
        return
    anchors.sort(key=lambda p: p.elapsed_time_s or 0)
    for p in points:
        if p.distance_m is not None or p.elapsed_time_s is None:
            continue
        exact = next((a for a in anchors if a.elapsed_time_s == p.elapsed_time_s), None)
        if exact:
            p.distance_m = exact.distance_m
            continue
        prev = next(
            (
                a
                for a in reversed(anchors)
                if (a.elapsed_time_s or 0) <= (p.elapsed_time_s or 0)
            ),
            None,
        )
        nxt = next(
            (a for a in anchors if (a.elapsed_time_s or 0) >= (p.elapsed_time_s or 0)),
            None,
        )
        if (
            prev
            and nxt
            and nxt.elapsed_time_s is not None
            and prev.elapsed_time_s is not None
            and nxt.elapsed_time_s > prev.elapsed_time_s
        ):
            f = ((p.elapsed_time_s or 0) - prev.elapsed_time_s) / (
                nxt.elapsed_time_s - prev.elapsed_time_s
            )
            p.distance_m = (
                float(prev.distance_m or 0)
                + (float(nxt.distance_m or 0) - float(prev.distance_m or 0)) * f
            )
        elif prev:
            p.distance_m = prev.distance_m
        elif nxt:
            p.distance_m = nxt.distance_m


def with_cumulative_distance(rows: Iterable) -> list[StreamPoint]:
    out: list[StreamPoint] = []
    dist = 0.0
    prev_gps = None
    for p in rows:
        source = p.distance_m
        if source is not None and source >= 0 and source >= dist:
            dist = float(source)
        elif (
            prev_gps
            and p.lat is not None
            and p.lon is not None
            and prev_gps.lat is not None
            and prev_gps.lon is not None
        ):
            dist += haversine_m(prev_gps.lat, prev_gps.lon, p.lat, p.lon)
        d = (
            dist
            if (source is not None or p.lat is not None and p.lon is not None)
            else None
        )
        out.append(
            StreamPoint(
                d,
                p.elapsed_time_s,
                p.lat,
                p.lon,
                valid_elevation(p.elevation_m),
                p.heart_rate_bpm,
                p.cadence_spm,
            )
        )
        if p.lat is not None and p.lon is not None:
            prev_gps = p
    _fill_missing_stream_distances_by_time(out)
    return out


def _interp_elapsed(points: list[StreamPoint], target_d: float) -> float | None:
    prev = None
    for p in points:
        if p.distance_m is None or p.elapsed_time_s is None:
            continue
        if p.distance_m == target_d:
            return p.elapsed_time_s
        if (
            prev
            and prev.distance_m is not None
            and prev.elapsed_time_s is not None
            and prev.distance_m <= target_d <= p.distance_m
            and p.distance_m > prev.distance_m
        ):
            f = (target_d - prev.distance_m) / (p.distance_m - prev.distance_m)
            return prev.elapsed_time_s + (p.elapsed_time_s - prev.elapsed_time_s) * f
        prev = p
    return None


def smoothed_pace_stream(points: list[StreamPoint], window_m: float = 50.0) -> Stream:
    valid = [
        p for p in points if p.distance_m is not None and p.elapsed_time_s is not None
    ]
    if len(valid) < 3:
        return []
    out: Stream = []
    half = window_m / 2
    min_d, max_d = valid[0].distance_m or 0, valid[-1].distance_m or 0
    for p in valid:
        d = p.distance_m
        if d is None or d - half < min_d or d + half > max_d:
            continue
        t1 = _interp_elapsed(valid, d - half)
        t2 = _interp_elapsed(valid, d + half)
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


def smoothed_elevation_stream(
    points: list[StreamPoint], window_m: float = 50.0
) -> Stream:
    valid = [
        p
        for p in points
        if p.distance_m is not None and valid_elevation(p.elevation_m) is not None
    ]
    if len(valid) < 2:
        return []
    out: Stream = []
    half = window_m / 2
    for p in valid:
        d = p.distance_m
        if d is None:
            continue
        vals = [
            valid_elevation(q.elevation_m)
            for q in valid
            if q.distance_m is not None and abs(q.distance_m - d) <= half
        ]
        vals = [v for v in vals if v is not None]
        if vals:
            out.append([d, float(median(vals))])
    return out


def sensor_stream(points: list[StreamPoint], attr: str) -> Stream:
    out: Stream = []
    for p in points:
        d = p.distance_m
        v = getattr(p, attr)
        if d is not None and d >= 0 and v is not None:
            out.append([d, float(v)])
    return out


def add_boundaries(stream: Stream, full_distance_m: float) -> Stream:
    points: Stream = []
    seen: set[float] = set()
    for d, v in stream:
        if d is None or d < 0:
            continue
        clamped = max(0.0, min(float(d), full_distance_m))
        key = round(clamped, 6)
        if key in seen:
            continue
        seen.add(key)
        points.append([clamped, v])
    points.sort(key=lambda x: float(x[0] or 0))
    if not points or (points[0][0] or 0) > 0:
        points.insert(0, [0.0, None])
    elif points[0][0] != 0:
        points[0][0] = 0.0
    if full_distance_m > 0:
        if not points or (points[-1][0] or 0) < full_distance_m:
            points.append([full_distance_m, None])
        elif (
            points[-1][0] != full_distance_m
            and abs(float(points[-1][0] or 0) - full_distance_m) < 1e-6
        ):
            points[-1][0] = full_distance_m
    return points


def build_streams(
    rows: Iterable, wanted: set[str], full_distance_m: float
) -> dict[str, Stream]:
    points = with_cumulative_distance(rows)
    streams: dict[str, Stream] = {}
    if "pace" in wanted:
        streams["pace"] = smoothed_pace_stream(points)
    if "elevation" in wanted:
        streams["elevation"] = smoothed_elevation_stream(points)
    if "heart_rate" in wanted:
        streams["heart_rate"] = sensor_stream(points, "heart_rate_bpm")
    if "cadence" in wanted:
        streams["cadence"] = sensor_stream(points, "cadence_spm")
    return {
        name: add_boundaries(stream, full_distance_m)
        for name, stream in streams.items()
    }


def downsample_streams(streams: dict[str, Stream]) -> dict[str, Stream]:
    return streams
