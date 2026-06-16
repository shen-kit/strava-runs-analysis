from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, delete, select

from ..db import get_session
from ..importer.derive import CleanPoint, generate_best_efforts
from ..models import Activity, AppSetting, BestEffort, BestEffortDistance, TrackPoint
from ..settings_defaults import (
    DEFAULT_BEST_EFFORT_DISTANCES,
    DEFAULT_SETTINGS,
    deep_merge,
)

router = APIRouter(prefix="/settings", tags=["settings"])
SETTINGS_KEY = "global"


class SettingsPayload(BaseModel):
    settings: dict[str, Any] | None = None


class BestEffortDistancePayload(BaseModel):
    id: int | None = None
    label: str
    distance_m: float
    enabled: bool = True
    sort_order: int = 0


class BestEffortDistancesPayload(BaseModel):
    distances: list[BestEffortDistancePayload]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def seed_best_effort_distances(session: Session) -> None:
    existing = session.exec(select(BestEffortDistance)).first()
    if existing:
        return
    for i, (label, distance_m) in enumerate(DEFAULT_BEST_EFFORT_DISTANCES):
        session.add(
            BestEffortDistance(
                label=label, distance_m=distance_m, enabled=True, sort_order=i
            )
        )
    session.commit()


def get_enabled_best_effort_distances(session: Session) -> list[BestEffortDistance]:
    seed_best_effort_distances(session)
    return session.exec(
        select(BestEffortDistance)
        .where(BestEffortDistance.enabled == True)
        .order_by(BestEffortDistance.sort_order, BestEffortDistance.distance_m)
    ).all()  # noqa: E712


def settings_with_defaults(value: dict[str, Any] | None) -> dict[str, Any]:
    settings = deep_merge(DEFAULT_SETTINGS, value or {})
    bucket = settings.get("dashboard", {}).get("defaultBucket")
    if bucket not in {"week", "month", "year"}:
        settings["dashboard"]["defaultBucket"] = "week"
    overlay = settings.get("maps", {}).get("defaultOverlay")
    if overlay not in {"none", "pace", "heart_rate", "gradient", "cadence"}:
        settings["maps"]["defaultOverlay"] = "none"
    map_type = settings.get("maps", {}).get("defaultMapType")
    if map_type not in {"satellite", "street"}:
        settings["maps"]["defaultMapType"] = "satellite"
    return settings


@router.get("")
def get_settings(session: Session = Depends(get_session)):
    row = session.get(AppSetting, SETTINGS_KEY)
    return settings_with_defaults(row.value_json if row else None)


@router.put("")
def put_settings(payload: dict[str, Any], session: Session = Depends(get_session)):
    data = (
        payload.get("settings")
        if isinstance(payload.get("settings"), dict)
        else payload
    )
    merged = settings_with_defaults(data or {})
    row = session.get(AppSetting, SETTINGS_KEY)
    if row:
        row.value_json = merged
        row.updated_at = _now()
        session.add(row)
    else:
        session.add(AppSetting(key=SETTINGS_KEY, value_json=merged, updated_at=_now()))
    session.commit()
    return merged


@router.get("/best-effort-distances")
def get_best_effort_distances(session: Session = Depends(get_session)):
    seed_best_effort_distances(session)
    rows = session.exec(
        select(BestEffortDistance).order_by(
            BestEffortDistance.sort_order, BestEffortDistance.distance_m
        )
    ).all()
    return rows


@router.put("/best-effort-distances")
def put_best_effort_distances(
    payload: BestEffortDistancesPayload, session: Session = Depends(get_session)
):
    items = payload.distances
    seen: set[int] = set()
    out: list[BestEffortDistance] = []
    for i, item in enumerate(items):
        label = item.label.strip() or f"{item.distance_m:g}m"
        distance_m = max(1.0, float(item.distance_m))
        row = session.get(BestEffortDistance, item.id) if item.id else None
        if row:
            seen.add(row.id or 0)
            row.label = label
            row.distance_m = distance_m
            row.enabled = True
            row.sort_order = item.sort_order if item.sort_order is not None else i
        else:
            row = BestEffortDistance(
                label=label,
                distance_m=distance_m,
                enabled=True,
                sort_order=item.sort_order if item.sort_order is not None else i,
            )
        session.add(row)
        out.append(row)
    existing = session.exec(select(BestEffortDistance)).all()
    incoming_ids = {item.id for item in items if item.id}
    for row in existing:
        if row.id and row.id not in incoming_ids and row.id not in seen:
            session.delete(row)
    session.commit()
    return session.exec(
        select(BestEffortDistance).order_by(
            BestEffortDistance.sort_order, BestEffortDistance.distance_m
        )
    ).all()


def _clean_points_for_activity(session: Session, activity_id: int) -> list[CleanPoint]:
    rows = session.exec(
        select(TrackPoint)
        .where(TrackPoint.activity_id == activity_id)
        .order_by(TrackPoint.point_index)
    ).all()
    points: list[CleanPoint] = []
    for p in rows:
        if p.elapsed_time_s is None or p.distance_m is None:
            continue
        points.append(
            CleanPoint(
                timestamp=p.timestamp or _now(),
                elapsed_time_s=p.elapsed_time_s,
                distance_m=p.distance_m,
                lat=p.lat,
                lon=p.lon,
                elevation_m=p.elevation_m,
                heart_rate_bpm=p.heart_rate_bpm,
                cadence_spm=p.cadence_spm,
                speed_mps=p.speed_mps,
            )
        )
    return points


@router.post("/best-effort-distances/recalculate")
def recalculate_best_effort_distances(session: Session = Depends(get_session)):
    distances = [d.distance_m for d in get_enabled_best_effort_distances(session)]
    session.exec(delete(BestEffort))
    count = 0
    for activity in session.exec(select(Activity)).all():
        if not activity.id:
            continue
        points = _clean_points_for_activity(session, activity.id)
        efforts, _ = generate_best_efforts(points, distances)
        for effort in efforts:
            session.add(BestEffort(activity_id=activity.id, **effort))
            count += 1
    session.commit()
    return {"status": "ok", "efforts": count, "distances": len(distances)}
