from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from ..db import get_session
from ..models import Activity, ActivityRoute, ActivitySplit, BestEffort, TrackPoint
from .stream_utils import build_streams, downsample_streams

router = APIRouter(prefix="/activities", tags=["activities"])


def activity_or_404(session: Session, activity_id: int) -> Activity:
    a = session.get(Activity, activity_id)
    if not a: raise HTTPException(status_code=404, detail="Activity not found")
    return a


def activity_summary(a: Activity) -> dict:
    return {
        "id":a.id,"title":a.title,"source_sport_type":a.source_sport_type,"start_time_utc":a.start_time_utc,"start_time_local":a.start_time_local,"local_date":a.local_date,"timezone":a.timezone,
        "source_distance_m":a.source_distance_m,"computed_distance_m":a.computed_distance_m,"moving_time_s":a.moving_time_s,"elapsed_time_s":a.elapsed_time_s,"elevation_gain_m":a.elevation_gain_m,
        "avg_pace_s_per_km":a.avg_pace_s_per_km,"avg_speed_mps":a.avg_speed_mps,"max_speed_mps":a.max_speed_mps,"avg_heart_rate_bpm":a.avg_heart_rate_bpm,"max_heart_rate_bpm":a.max_heart_rate_bpm,"avg_cadence_spm":a.avg_cadence_spm,
        "source_activity_id":a.source_activity_id,"source_filename":a.source_filename,"file_hash":a.file_hash,
    }


@router.get("")
def list_activities(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), year: int | None = None, session: Session = Depends(get_session)):
    q = select(Activity)
    if year: q = q.where(Activity.local_date >= f"{year}-01-01", Activity.local_date <= f"{year}-12-31")
    q = q.order_by(Activity.start_time_utc.desc()).offset(offset).limit(limit)
    return [activity_summary(a) for a in session.exec(q).all()]


@router.get("/{activity_id}")
def get_activity(activity_id: int, session: Session = Depends(get_session)):
    return activity_summary(activity_or_404(session, activity_id))


@router.get("/{activity_id}/route")
def get_route(activity_id: int, session: Session = Depends(get_session)):
    activity_or_404(session, activity_id)
    r = session.exec(select(ActivityRoute).where(ActivityRoute.activity_id == activity_id)).one_or_none()
    if not r: return {"activity_id":activity_id,"simplified_points_json":[],"original_point_count":0,"simplified_point_count":0,"simplification_tolerance_m":None}
    return {"activity_id":activity_id,"simplified_points_json":r.simplified_points_json,"original_point_count":r.original_point_count,"simplified_point_count":r.simplified_point_count,"simplification_tolerance_m":r.simplification_tolerance_m}


@router.get("/{activity_id}/splits")
def get_splits(activity_id: int, session: Session = Depends(get_session)):
    activity_or_404(session, activity_id)
    rows = session.exec(select(ActivitySplit).where(ActivitySplit.activity_id == activity_id).order_by(ActivitySplit.split_index)).all()
    return [r.model_dump() for r in rows]


@router.get("/{activity_id}/best-efforts")
def get_best_efforts(activity_id: int, session: Session = Depends(get_session)):
    activity_or_404(session, activity_id)
    rows = session.exec(select(BestEffort).where(BestEffort.activity_id == activity_id).order_by(BestEffort.distance_m)).all()
    return [r.model_dump() for r in rows]


@router.get("/{activity_id}/streams")
def get_streams(activity_id: int, types: str = "pace,heart_rate,cadence,elevation", session: Session = Depends(get_session)):
    activity_or_404(session, activity_id)
    wanted = {x.strip() for x in types.split(",") if x.strip()}
    rows = session.exec(select(TrackPoint).where(TrackPoint.activity_id == activity_id).order_by(TrackPoint.point_index)).all()
    streams = build_streams(rows, wanted)
    return {"activity_id":activity_id,"x_axis":"distance_m","streams":downsample_streams(streams)}


@router.get("/{activity_id}/track-points")
def get_track_points(activity_id: int, session: Session = Depends(get_session)):
    activity_or_404(session, activity_id)
    rows = session.exec(select(TrackPoint).where(TrackPoint.activity_id == activity_id).order_by(TrackPoint.point_index)).all()
    return [r.model_dump() for r in rows]
