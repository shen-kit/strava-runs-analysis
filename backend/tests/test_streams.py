from datetime import date, datetime, timezone, timedelta
from sqlmodel import Session, SQLModel
from fastapi.testclient import TestClient

from app.db import engine, init_db
from app.main import app
from app.models import Activity, TrackPoint
from app.importer.parsers import ParsedTrackPoint, enrich_cumulative_distance
from app.api.stream_utils import build_streams


def setup_function():
    SQLModel.metadata.drop_all(engine)
    init_db()


def test_gpx_like_points_without_distance_get_cumulative_distance():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    pts = [
        ParsedTrackPoint(timestamp=t, lat=-37.0, lon=145.0),
        ParsedTrackPoint(timestamp=t + timedelta(seconds=60), lat=-37.0, lon=145.001),
        ParsedTrackPoint(timestamp=t + timedelta(seconds=120), lat=-37.0, lon=145.002),
    ]
    enrich_cumulative_distance(pts)
    assert pts[0].distance_m == 0
    assert pts[1].distance_m and pts[1].distance_m > 80
    assert pts[2].distance_m and pts[2].distance_m > pts[1].distance_m


def insert_activity(points: list[dict]) -> int:
    with Session(engine) as s:
        a = Activity(title="stream test", source_sport_type="Run", local_date=date(2026, 1, 1))
        s.add(a); s.flush()
        for i, p in enumerate(points):
            s.add(TrackPoint(activity_id=a.id, point_index=i, **p))
        s.commit(); return a.id


def test_missing_elevation_and_invalid_pace_do_not_become_zero():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t, "elapsed_time_s": 0, "distance_m": 0, "elevation_m": None, "speed_mps": None},
        {"timestamp": t + timedelta(seconds=10), "elapsed_time_s": 10, "distance_m": 10, "elevation_m": None, "speed_mps": 0},
    ])
    res = TestClient(app).get(f"/activities/{aid}/streams?types=pace,elevation").json()
    assert res["streams"]["elevation"] == []
    assert res["streams"]["pace"] == []


def test_smoothed_pace_stable_synthetic_run():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t + timedelta(seconds=i * 30), "elapsed_time_s": i * 30, "distance_m": i * 100, "elevation_m": 10}
        for i in range(11)
    ])
    res = TestClient(app).get(f"/activities/{aid}/streams?types=pace").json()
    pace = [v for _, v in res["streams"]["pace"]]
    assert pace
    assert all(295 <= v <= 305 for v in pace)
    assert 0 not in pace


def test_elevation_smoothing_preserves_real_values_ignores_missing():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t + timedelta(seconds=i * 30), "elapsed_time_s": i * 30, "distance_m": i * 25, "elevation_m": (100 + i if i % 2 == 0 else None)}
        for i in range(8)
    ])
    res = TestClient(app).get(f"/activities/{aid}/streams?types=elevation").json()
    elev = [v for _, v in res["streams"]["elevation"]]
    assert elev
    assert all(v >= 100 for v in elev)
    assert 0 not in elev


def test_gpx_like_activity_has_pace_without_source_distance():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t + timedelta(seconds=i * 30), "elapsed_time_s": i * 30, "distance_m": None, "lat": -37.0, "lon": 145.0 + i * 0.001}
        for i in range(8)
    ])
    res = TestClient(app).get(f"/activities/{aid}/streams?types=pace").json()
    assert res["streams"]["pace"]
    assert all(v > 0 for _, v in res["streams"]["pace"])
