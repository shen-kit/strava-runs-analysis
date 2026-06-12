from __future__ import annotations
from collections import defaultdict
from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select
from ..db import get_session
from ..models import Activity, BestEffort
from .settings import get_enabled_best_effort_distances

router = APIRouter(prefix="/stats", tags=["stats"])


def bucket_key(d: date, bucket: str) -> str:
    if bucket == "year": return f"{d.year}"
    if bucket == "month": return f"{d.year:04d}-{d.month:02d}"
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def get_activities(session: Session):
    return session.exec(select(Activity)).all()


def activity_distance_m(a: Activity) -> float:
    return a.source_distance_m if a.source_distance_m is not None else (a.computed_distance_m or 0)


def activity_duration_s(a: Activity) -> float:
    return a.moving_time_s if a.moving_time_s is not None else (a.elapsed_time_s or 0)


def _totals_rows(acts: list[Activity], bucket: str):
    groups = defaultdict(lambda: {"bucket":None,"run_count":0,"distance_m":0.0,"moving_time_s":0.0,"elevation_gain_m":0.0,"days_run":set()})
    for a in acts:
        k = bucket_key(a.local_date, bucket); g = groups[k]; g["bucket"] = k; g["run_count"] += 1; g["distance_m"] += activity_distance_m(a); g["moving_time_s"] += activity_duration_s(a); g["elevation_gain_m"] += a.elevation_gain_m or 0; g["days_run"].add(a.local_date.isoformat())
    rows=[]
    for k in sorted(groups):
        g=groups[k]; rows.append({**g, "days_run": len(g["days_run"])})
    return rows


@router.get("/summary")
def summary(session: Session = Depends(get_session)):
    acts = get_activities(session)
    today = date.today()
    total_runs = len(acts)
    dist = sum(activity_distance_m(a) for a in acts)
    move = sum(activity_duration_s(a) for a in acts)
    elev = sum(a.elevation_gain_m or 0 for a in acts)
    return {
        "total_runs": total_runs,
        "total_distance_m": dist,
        "total_moving_time_s": move,
        "total_elevation_gain_m": elev,
        "average_pace_s_per_km": move/(dist/1000) if dist > 0 and move > 0 else None,
        "longest_run_distance_m": max([activity_distance_m(a) for a in acts], default=0),
        "latest_activity_date": max([a.local_date for a in acts], default=None),
        "current_month_distance_m": sum(activity_distance_m(a) for a in acts if a.local_date.year == today.year and a.local_date.month == today.month),
        "current_year_distance_m": sum(activity_distance_m(a) for a in acts if a.local_date.year == today.year),
    }


@router.get("/totals")
def totals(bucket: str = Query("week", pattern="^(week|month|year)$"), session: Session = Depends(get_session)):
    return [{k:v for k,v in r.items() if k != "days_run"} for r in _totals_rows(get_activities(session), bucket)]


@router.get("/weekly-volume")
def weekly_volume(session: Session = Depends(get_session)):
    rows = _totals_rows(get_activities(session), "week")
    for i, r in enumerate(rows):
        window = rows[max(0, i-3):i+1]
        r["rolling_4_week_avg_distance_m"] = sum(w["distance_m"] for w in window) / len(window) if window else None
    return rows


@router.get("/consistency")
def consistency(session: Session = Depends(get_session)):
    rows = _totals_rows(get_activities(session), "week")
    current_week = bucket_key(date.today(), "week")
    nonzero = [r for r in rows if r["run_count"] > 0]
    return {
        "weeks": rows,
        "current_week_count": next((r["run_count"] for r in rows if r["bucket"] == current_week), 0),
        "average_runs_per_week": sum(r["run_count"] for r in nonzero) / len(nonzero) if nonzero else 0,
    }


@router.get("/pace-trend")
def pace_trend(bucket: str = Query("week", pattern="^(week|month|year)$"), session: Session = Depends(get_session)):
    rows = _totals_rows(get_activities(session), bucket)
    return [{"bucket":r["bucket"],"pace_s_per_km":(r["moving_time_s"]/(r["distance_m"]/1000) if r["distance_m"] > 0 and r["moving_time_s"] > 0 else None)} for r in rows]


@router.get("/elevation")
def elevation(bucket: str = Query("week", pattern="^(week|month|year)$"), session: Session = Depends(get_session)):
    return [{"bucket":r["bucket"],"elevation_gain_m":r["elevation_gain_m"]} for r in _totals_rows(get_activities(session), bucket)]


@router.get("/personal-bests")
def personal_bests(session: Session = Depends(get_session)):
    distance_rows = get_enabled_best_effort_distances(session)
    labels = {row.distance_m: row.label for row in distance_rows}
    targets = set(labels)
    efforts = session.exec(select(BestEffort, Activity).join(Activity, Activity.id == BestEffort.activity_id).order_by(BestEffort.distance_m, BestEffort.duration_s)).all()
    best = {}
    for effort, act in efforts:
        if effort.distance_m in targets and effort.distance_m not in best:
            best[effort.distance_m] = {"distance_m":effort.distance_m,"label":labels[effort.distance_m],"duration_s":effort.duration_s,"pace_s_per_km":effort.pace_s_per_km,"activity_id":act.id,"activity_title":act.title,"local_date":act.local_date}
    return [best[row.distance_m] for row in distance_rows if row.distance_m in best]


@router.get("/best-effort-trend")
def best_effort_trend(distances: str = "", session: Session = Depends(get_session)):
    targets = {float(x) for x in distances.split(",") if x.strip()} if distances else {row.distance_m for row in get_enabled_best_effort_distances(session)}
    rows = session.exec(select(BestEffort, Activity).join(Activity, Activity.id == BestEffort.activity_id).order_by(Activity.local_date)).all()
    out=[]
    for effort, act in rows:
        if effort.distance_m in targets:
            out.append({"distance_m": effort.distance_m, "duration_s": effort.duration_s, "pace_s_per_km": effort.pace_s_per_km, "activity_id": act.id, "activity_title": act.title, "local_date": act.local_date})
    return out


@router.get("/long-run-progression")
def long_run_progression(bucket: str = Query("week", pattern="^(week|month|year)$"), session: Session = Depends(get_session)):
    groups = defaultdict(lambda: {"bucket":None,"longest_run_distance_m":0.0,"activity_id":None,"activity_title":None,"local_date":None})
    for a in get_activities(session):
        k=bucket_key(a.local_date,bucket); d=activity_distance_m(a); g=groups[k]; g["bucket"]=k
        if d > g["longest_run_distance_m"]:
            g.update({"longest_run_distance_m":d,"activity_id":a.id,"activity_title":a.title,"local_date":a.local_date})
    return [groups[k] for k in sorted(groups)]


@router.get("/distance-distribution")
def distance_distribution(session: Session = Depends(get_session)):
    buckets=[("0-5km",0,5000), ("5-10km",5000,10000), ("10-15km",10000,15000), ("15-21.1km",15000,21097.5), ("21.1km+",21097.5,float("inf"))]
    out=[{"bucket":name,"run_count":0,"distance_m":0.0} for name,_,__ in buckets]
    for a in get_activities(session):
        d=activity_distance_m(a)
        for i,(_,lo,hi) in enumerate(buckets):
            if lo <= d < hi:
                out[i]["run_count"] += 1; out[i]["distance_m"] += d; break
    return out
