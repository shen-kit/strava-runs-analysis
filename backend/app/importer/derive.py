from __future__ import annotations
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable
from .parsers import ParsedTrackPoint

MAX_RUNNING_SPEED_MPS = 10.0
MAX_BEST_EFFORT_GAP_S = 300.0
BEST_EFFORT_DISTANCES_M = [
    400.0,
    800.0,
    1000.0,
    1609.344,
    3000.0,
    5000.0,
    10000.0,
    15000.0,
    21097.5,
    42195.0,
]


@dataclass
class CleanPoint:
    timestamp: datetime
    elapsed_time_s: float
    distance_m: float
    lat: float | None
    lon: float | None
    elevation_m: float | None
    heart_rate_bpm: float | None
    cadence_spm: float | None
    speed_mps: float | None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def clean_points(
    points: list[ParsedTrackPoint],
) -> tuple[list[CleanPoint], list[str], list[str]]:
    warnings: list[str] = []
    dropped: list[str] = []
    cleaned: list[CleanPoint] = []
    first_ts = None
    last: CleanPoint | None = None
    use_source_distance = sum(1 for p in points if p.distance_m is not None) >= max(
        2, len(points) // 2
    )
    for p in points:
        if p.timestamp is None:
            dropped.append("missing_timestamp")
            continue
        if first_ts is None:
            first_ts = p.timestamp
        elapsed = (p.timestamp - first_ts).total_seconds()
        if last and elapsed <= last.elapsed_time_s:
            dropped.append("non_increasing_timestamp")
            continue
        if p.lat is None or p.lon is None:
            if not use_source_distance:
                dropped.append("missing_coordinates")
                continue
        if last:
            dt = elapsed - last.elapsed_time_s
            if (
                use_source_distance
                and p.distance_m is not None
                and p.distance_m >= last.distance_m
            ):
                dist = float(p.distance_m)
                seg = dist - last.distance_m
            elif (
                p.lat is not None
                and p.lon is not None
                and last.lat is not None
                and last.lon is not None
            ):
                seg = haversine_m(last.lat, last.lon, p.lat, p.lon)
                dist = last.distance_m + seg
            else:
                dropped.append("missing_distance_or_coordinates")
                continue
            if dt > 0 and seg / dt > MAX_RUNNING_SPEED_MPS:
                dropped.append("gps_spike_impossible_speed")
                continue
        else:
            dist = float(p.distance_m or 0.0) if use_source_distance else 0.0
        cp = CleanPoint(
            p.timestamp,
            elapsed,
            dist,
            p.lat,
            p.lon,
            p.elevation_m,
            p.heart_rate_bpm,
            p.cadence_spm,
            p.speed_mps,
        )
        cleaned.append(cp)
        last = cp
    if not any(p.heart_rate_bpm is not None for p in points):
        warnings.append("missing_heart_rate")
    if not any(p.cadence_spm is not None for p in points):
        warnings.append("missing_cadence")
    if len(cleaned) < 2:
        warnings.append("not_enough_clean_points")
    if dropped:
        warnings.append(f"dropped_points:{len(dropped)}")
    return cleaned, warnings, dropped


def computed_distance_m(cleaned: list[CleanPoint]) -> float | None:
    return cleaned[-1].distance_m - cleaned[0].distance_m if len(cleaned) >= 2 else None


def interpolate_at_distance(
    points: list[CleanPoint], distance_m: float
) -> CleanPoint | None:
    if not points:
        return None
    if distance_m <= points[0].distance_m:
        return points[0]
    for a, b in zip(points, points[1:]):
        if a.distance_m <= distance_m <= b.distance_m and b.distance_m > a.distance_m:
            f = (distance_m - a.distance_m) / (b.distance_m - a.distance_m)

            def lerp(x, y):
                return None if x is None or y is None else x + (y - x) * f

            return CleanPoint(
                b.timestamp,
                a.elapsed_time_s + (b.elapsed_time_s - a.elapsed_time_s) * f,
                distance_m,
                lerp(a.lat, b.lat),
                lerp(a.lon, b.lon),
                lerp(a.elevation_m, b.elevation_m),
                lerp(a.heart_rate_bpm, b.heart_rate_bpm),
                lerp(a.cadence_spm, b.cadence_spm),
                lerp(a.speed_mps, b.speed_mps),
            )
    return points[-1] if distance_m <= points[-1].distance_m else None


def mean(vals: Iterable[float | None]) -> float | None:
    xs = [float(v) for v in vals if v is not None]
    return sum(xs) / len(xs) if xs else None


def generate_splits(points: list[CleanPoint]) -> tuple[list[dict], list[str]]:
    warnings = []
    splits = []
    total = computed_distance_m(points)
    if total is None or total < 1000:
        return splits, ["not_enough_distance_for_splits"]
    start_base = points[0].distance_m
    count = int(total // 1000)
    for i in range(count):
        sd = start_base + i * 1000
        ed = sd + 1000
        a = interpolate_at_distance(points, sd)
        b = interpolate_at_distance(points, ed)
        if not a or not b or b.elapsed_time_s <= a.elapsed_time_s:
            continue
        in_range = [p for p in points if sd <= p.distance_m <= ed]
        dur = b.elapsed_time_s - a.elapsed_time_s
        splits.append(
            {
                "split_type": "km",
                "split_index": i + 1,
                "start_distance_m": sd - start_base,
                "end_distance_m": ed - start_base,
                "distance_m": 1000.0,
                "duration_s": dur,
                "avg_pace_s_per_km": dur,
                "avg_heart_rate_bpm": mean(p.heart_rate_bpm for p in in_range),
                "avg_cadence_spm": mean(p.cadence_spm for p in in_range),
            }
        )
    return splits, warnings


def has_long_gap(points: list[CleanPoint], start_d: float, end_d: float) -> bool:
    prev = None
    for p in points:
        if start_d <= p.distance_m <= end_d:
            if prev and p.elapsed_time_s - prev.elapsed_time_s > MAX_BEST_EFFORT_GAP_S:
                return True
            prev = p
    return False


def generate_best_efforts(
    points: list[CleanPoint], distances_m: list[float] | None = None
) -> tuple[list[dict], list[str]]:
    warnings = []
    efforts = []
    targets = sorted(
        float(d) for d in (distances_m or BEST_EFFORT_DISTANCES_M) if d > 0
    )
    total = computed_distance_m(points)
    if not targets or total is None or total < min(targets):
        return efforts, ["not_enough_distance_for_best_efforts"]
    start_base = points[0].distance_m
    max_d = points[-1].distance_m
    for target in targets:
        if total + 0.1 < target:
            continue
        best = None
        for sp in points:
            sd = sp.distance_m
            ed = sd + target
            if ed > max_d:
                break
            ep = interpolate_at_distance(points, ed)
            if not ep or has_long_gap(points, sd, ed):
                continue
            dur = ep.elapsed_time_s - sp.elapsed_time_s
            if dur > 0 and (best is None or dur < best[0]):
                best = (dur, sp, ep)
        if best:
            dur, sp, ep = best
            efforts.append(
                {
                    "distance_m": target,
                    "duration_s": dur,
                    "pace_s_per_km": dur / (target / 1000),
                    "start_elapsed_time_s": sp.elapsed_time_s,
                    "end_elapsed_time_s": ep.elapsed_time_s,
                    "start_distance_m": sp.distance_m - start_base,
                    "end_distance_m": ep.distance_m - start_base,
                    "start_lat": sp.lat,
                    "start_lon": sp.lon,
                    "end_lat": ep.lat,
                    "end_lon": ep.lon,
                }
            )
    if not efforts:
        warnings.append("no_valid_best_effort_windows")
    return efforts, warnings


def _perp_dist_m(p, a, b):
    if a == b:
        return haversine_m(p[0], p[1], a[0], a[1])
    lat0 = (a[0] + b[0] + p[0]) / 3

    def xy(q):
        return (
            math.radians(q[1]) * 6371000 * math.cos(math.radians(lat0)),
            math.radians(q[0]) * 6371000,
        )

    px, py = xy(p)
    ax, ay = xy(a)
    bx, by = xy(b)
    num = abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax)
    den = math.hypot(by - ay, bx - ax)
    return num / den if den else 0


def rdp(
    points: list[tuple[float, float, float | None]], tol: float
) -> list[tuple[float, float, float | None]]:
    if len(points) <= 2:
        return points
    a, b = points[0], points[-1]
    idx, point = max(
        enumerate(points[1:-1], 1),
        key=lambda x: _perp_dist_m(x[1], a, b),
        default=(0, a),
    )
    dist = _perp_dist_m(point, a, b)
    if dist > tol:
        return rdp(points[: idx + 1], tol)[:-1] + rdp(points[idx:], tol)
    return [a, b]


def simplify_route(points: list[CleanPoint], tolerance_m: float = 3.0) -> dict | None:
    raw = [
        (p.lat, p.lon, p.elevation_m)
        for p in points
        if p.lat is not None and p.lon is not None
    ]
    if len(raw) < 2:
        return None
    simp = rdp(raw, tolerance_m)
    arr = [[lat, lon, ele] for lat, lon, ele in simp]
    return {
        "simplified_points_json": arr,
        "original_point_count": len(raw),
        "simplified_point_count": len(arr),
        "simplification_tolerance_m": tolerance_m,
    }
