from __future__ import annotations
import csv
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

RUN_SPORT_TYPES = {"Run", "TrailRun", "VirtualRun"}


@dataclass
class StravaActivityRow:
    source_activity_id: str | None
    title: str
    description: str | None
    sport_type: str
    filename: str | None
    activity_date_raw: str | None
    start_time_utc: datetime | None
    start_time_local: datetime | None
    local_date: object
    timezone: str | None
    source_distance_m: float | None
    moving_time_s: float | None
    elapsed_time_s: float | None
    elevation_gain_m: float | None
    avg_speed_mps: float | None
    max_speed_mps: float | None
    avg_heart_rate_bpm: float | None
    max_heart_rate_bpm: float | None
    avg_cadence_spm: float | None
    warnings: list[str]


def f(row: dict, name: str) -> str | None:
    v = row.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else None


def num(row: dict, name: str) -> float | None:
    v = f(row, name)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def cadence_spm(v: float | None) -> float | None:
    return v * 2 if v is not None and 20 <= v < 130 else v


def parse_activity_date(value: str | None, default_tz: str):
    tz = ZoneInfo(default_tz)
    if not value:
        now = datetime.now(timezone.utc)
        return (
            now,
            now.astimezone(tz),
            now.astimezone(tz).date(),
            default_tz,
            ["missing_activity_date_used_now"],
        )
    warnings = []
    for fmt in ("%b %d, %Y, %I:%M:%S %p", "%b %d, %Y, %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            naive = datetime.strptime(value, fmt)
            utc = naive.replace(tzinfo=timezone.utc)
            local = utc.astimezone(tz)
            warnings.append("timezone_missing_used_default")
            return utc, local, local.date(), default_tz, warnings
        except ValueError:
            pass
    now = datetime.now(timezone.utc)
    local = now.astimezone(tz)
    warnings.append("failed_to_parse_activity_date_used_now")
    return now, local, local.date(), default_tz, warnings


def read_activities_csv(
    path: Path, default_tz: str
) -> tuple[list[StravaActivityRow], list[str]]:
    rows = []
    warnings = []
    with path.open(newline="", encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            utc, local, local_date, tz, ws = parse_activity_date(
                f(row, "Activity Date") or f(row, "Start Time"), default_tz
            )
            warnings.extend(ws)
            rows.append(
                StravaActivityRow(
                    source_activity_id=f(row, "Activity ID"),
                    title=f(row, "Activity Name") or "Untitled activity",
                    description=f(row, "Activity Description"),
                    sport_type=f(row, "Activity Type") or f(row, "Type") or "",
                    filename=f(row, "Filename"),
                    activity_date_raw=f(row, "Activity Date"),
                    start_time_utc=utc,
                    start_time_local=local,
                    local_date=local_date,
                    timezone=tz,
                    source_distance_m=num(row, "Distance"),
                    moving_time_s=num(row, "Moving Time"),
                    elapsed_time_s=num(row, "Elapsed Time"),
                    elevation_gain_m=num(row, "Elevation Gain"),
                    avg_speed_mps=num(row, "Average Speed"),
                    max_speed_mps=num(row, "Max Speed"),
                    avg_heart_rate_bpm=num(row, "Average Heart Rate"),
                    max_heart_rate_bpm=num(row, "Max Heart Rate"),
                    avg_cadence_spm=cadence_spm(num(row, "Average Cadence")),
                    warnings=ws,
                )
            )
    return rows, warnings


def fallback_dedupe_key(row: StravaActivityRow) -> str:
    base = f"{row.start_time_utc.isoformat() if row.start_time_utc else row.activity_date_raw}|{row.sport_type}|{row.source_distance_m}|{row.moving_time_s or row.elapsed_time_s}"
    return hashlib.sha256(base.encode()).hexdigest()


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
