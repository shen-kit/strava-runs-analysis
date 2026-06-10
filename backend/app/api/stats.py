from __future__ import annotations
from collections import defaultdict
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select
from ..db import get_session
from ..models import Activity, BestEffort

router = APIRouter(prefix="/stats", tags=["stats"])


def bucket_key(d: date, bucket: str) -> str:
    if bucket == "year": return f"{d.year}"
    if bucket == "month": return f"{d.year:04d}-{d.month:02d}"
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def get_activities(session: Session):
    return session.exec(select(Activity)).all()


@router.get("/summary")
def summary(session: Session = Depends(get_session)):
    acts = get_activities(session)
    total_runs = len(acts)
    dist = sum(a.source_distance_m or 0 for a in acts)
    move = sum(a.moving_time_s or 0 for a in acts)
    elev = sum(a.elevation_gain_m or 0 for a in acts)
    return {
        "total_runs": total_runs,
        "total_distance_m": dist,
        "total_moving_time_s": move,
        "total_elevation_gain_m": elev,
        "average_pace_s_per_km": move/(dist/1000) if dist > 0 and move > 0 else None,
        "longest_run_distance_m": max([a.source_distance_m or 0 for a in acts], default=0),
        "latest_activity_date": max([a.local_date for a in acts], default=None),
    }


@router.get("/totals")
def totals(bucket: str = Query("week", pattern="^(week|month|year)$"), session: Session = Depends(get_session)):
    groups = defaultdict(lambda: {"bucket":None,"run_count":0,"distance_m":0.0,"moving_time_s":0.0,"elevation_gain_m":0.0})
    for a in get_activities(session):
        k = bucket_key(a.local_date, bucket); g = groups[k]; g["bucket"] = k; g["run_count"] += 1; g["distance_m"] += a.source_distance_m or 0; g["moving_time_s"] += a.moving_time_s or 0; g["elevation_gain_m"] += a.elevation_gain_m or 0
    return [groups[k] for k in sorted(groups)]


@router.get("/pace-trend")
def pace_trend(bucket: str = Query("week", pattern="^(week|month|year)$"), session: Session = Depends(get_session)):
    rows = totals(bucket, session)
    return [{"bucket":r["bucket"],"pace_s_per_km":(r["moving_time_s"]/(r["distance_m"]/1000) if r["distance_m"] > 0 and r["moving_time_s"] > 0 else None)} for r in rows]


@router.get("/elevation")
def elevation(bucket: str = Query("week", pattern="^(week|month|year)$"), session: Session = Depends(get_session)):
    return [{"bucket":r["bucket"],"elevation_gain_m":r["elevation_gain_m"]} for r in totals(bucket, session)]


@router.get("/personal-bests")
def personal_bests(session: Session = Depends(get_session)):
    efforts = session.exec(select(BestEffort, Activity).join(Activity, Activity.id == BestEffort.activity_id).order_by(BestEffort.distance_m, BestEffort.duration_s)).all()
    best = {}
    for effort, act in efforts:
        if effort.distance_m not in best:
            best[effort.distance_m] = {"distance_m":effort.distance_m,"duration_s":effort.duration_s,"pace_s_per_km":effort.pace_s_per_km,"activity_id":act.id,"activity_title":act.title,"local_date":act.local_date}
    return [best[k] for k in sorted(best)]
