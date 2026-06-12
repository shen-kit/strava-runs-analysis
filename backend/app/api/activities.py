from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from ..db import get_session
from ..models import Activity, ActivityRoute, ActivitySplit, BestEffort, TrackPoint
from .stream_utils import build_streams, downsample_streams, with_cumulative_distance

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


@router.delete("/{activity_id}")
def delete_activity(activity_id: int, session: Session = Depends(get_session)):
    activity = activity_or_404(session, activity_id)
    for cls in (TrackPoint, ActivitySplit, BestEffort, ActivityRoute):
        for obj in session.exec(select(cls).where(cls.activity_id == activity_id)).all():
            session.delete(obj)
    session.delete(activity)
    session.commit()
    return {"status": "deleted", "activity_id": activity_id}


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
    activity = activity_or_404(session, activity_id)
    wanted = {x.strip() for x in types.split(",") if x.strip()}
    rows = session.exec(select(TrackPoint).where(TrackPoint.activity_id == activity_id).order_by(TrackPoint.point_index)).all()
    full_distance_m = activity.source_distance_m or activity.computed_distance_m or max([p.distance_m or 0 for p in rows], default=0)
    streams = build_streams(rows, wanted, full_distance_m)
    return {"activity_id":activity_id,"x_axis":"distance_m","x_domain_m":[0, full_distance_m],"streams":downsample_streams(streams)}


def _interp_stream(stream: list[list[float | None]], distance_m: float) -> float | None:
    pts = [(float(d), float(v)) for d, v in stream if d is not None and v is not None]
    if not pts:
        return None
    if distance_m <= pts[0][0]:
        return pts[0][1]
    for (d1, v1), (d2, v2) in zip(pts, pts[1:]):
        if d1 <= distance_m <= d2 and d2 > d1:
            f = (distance_m - d1) / (d2 - d1)
            return v1 + (v2 - v1) * f
    return pts[-1][1] if distance_m <= pts[-1][0] else None


@router.get("/{activity_id}/route-overlay")
def get_route_overlay(activity_id: int, metric: str = Query("pace", pattern="^(pace|heart_rate|gradient|cadence)$"), session: Session = Depends(get_session)):
    activity = activity_or_404(session, activity_id)
    rows = session.exec(select(TrackPoint).where(TrackPoint.activity_id == activity_id).order_by(TrackPoint.point_index)).all()
    full_distance_m = activity.source_distance_m or activity.computed_distance_m or max([p.distance_m or 0 for p in rows], default=0)
    points = with_cumulative_distance(rows)
    gps = [p for p in points if p.lat is not None and p.lon is not None and p.distance_m is not None]
    markers = []
    if gps:
        markers.append({"type":"start","coordinates":[gps[0].lon, gps[0].lat]})
        markers.append({"type":"finish","coordinates":[gps[-1].lon, gps[-1].lat]})
        for a, b in zip(gps, gps[1:]):
            if a.elapsed_time_s is not None and b.elapsed_time_s is not None and b.elapsed_time_s - a.elapsed_time_s > 15:
                markers.append({"type":"pause","coordinates":[b.lon, b.lat], "gap_s": b.elapsed_time_s - a.elapsed_time_s})

    stream_types = {"pace":"pace", "heart_rate":"heart_rate", "cadence":"cadence", "gradient":"elevation"}
    streams = build_streams(rows, {stream_types[metric]}, full_distance_m)
    stream = streams.get(stream_types[metric], [])
    features = []
    for a, b in zip(gps, gps[1:]):
        if b.distance_m <= a.distance_m:
            continue
        mid = (a.distance_m + b.distance_m) / 2
        if metric == "gradient":
            e1 = _interp_stream(stream, max(0, mid - 50)); e2 = _interp_stream(stream, min(full_distance_m, mid + 50))
            span = min(full_distance_m, mid + 50) - max(0, mid - 50)
            value = ((e2 - e1) / span * 100) if e1 is not None and e2 is not None and span > 0 else None
        else:
            value = _interp_stream(stream, mid)
        if value is None:
            continue
        features.append({"type":"Feature","properties":{"value":float(value)},"geometry":{"type":"LineString","coordinates":[[a.lon,a.lat],[b.lon,b.lat]]}})
    vals = [f["properties"]["value"] for f in features]
    units = {"pace":"s_per_km", "heart_rate":"bpm", "gradient":"percent", "cadence":"spm"}
    return {"activity_id":activity_id,"metric":metric,"unit":units[metric],"min_value":min(vals) if vals else None,"max_value":max(vals) if vals else None,"has_heart_rate":any(p.heart_rate_bpm is not None for p in rows),"has_cadence":any(p.cadence_spm is not None for p in rows),"markers":markers,"geojson":{"type":"FeatureCollection","features":features}}


@router.get("/{activity_id}/track-points")
def get_track_points(activity_id: int, session: Session = Depends(get_session)):
    activity_or_404(session, activity_id)
    rows = session.exec(select(TrackPoint).where(TrackPoint.activity_id == activity_id).order_by(TrackPoint.point_index)).all()
    return [r.model_dump() for r in rows]
