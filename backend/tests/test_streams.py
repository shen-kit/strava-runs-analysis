from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from sqlmodel import Session, SQLModel
from fastapi.testclient import TestClient

from app.db import engine, init_db
from app.main import app
from app.models import Activity, TrackPoint
from app.importer.parsers import FitTrackPointsParser, ParsedTrackPoint, enrich_cumulative_distance, normalize_elevation


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


def insert_activity(points: list[dict], source_distance_m: float | None = None) -> int:
    with Session(engine) as s:
        a = Activity(title="stream test", source_sport_type="Run", local_date=date(2026, 1, 1), source_distance_m=source_distance_m)
        s.add(a); s.flush()
        for i, p in enumerate(points):
            s.add(TrackPoint(activity_id=a.id, point_index=i, **p))
        s.commit(); return a.id


def test_missing_elevation_normalizer_does_not_emit_minus_one_or_zero():
    assert normalize_elevation(None) is None
    assert normalize_elevation(-1) is None
    assert normalize_elevation(0) == 0
    assert normalize_elevation(123.4) == 123.4


def test_fit_sparse_sensor_points_get_interpolated_distance():
    pts = [
        ParsedTrackPoint(timestamp=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc), lat=-37.0, lon=145.0),
        ParsedTrackPoint(timestamp=datetime(2026, 1, 1, 0, 0, 5, tzinfo=timezone.utc), heart_rate_bpm=120, elevation_m=50),
        ParsedTrackPoint(timestamp=datetime(2026, 1, 1, 0, 0, 10, tzinfo=timezone.utc), lat=-37.0, lon=145.001),
    ]
    enrich_cumulative_distance(pts)
    assert pts[1].distance_m is not None
    assert pts[0].distance_m < pts[1].distance_m < pts[2].distance_m


def test_fit_missing_elevation_sentinel_becomes_none():
    parser = FitTrackPointsParser()
    pts = parser.normalize([{"timestamp": datetime(2026, 1, 1), "enhanced_altitude": -1, "altitude": -1}])
    assert pts[0].elevation_m is None
    pts = parser.normalize([{"timestamp": datetime(2026, 1, 1), "enhanced_altitude": -1, "altitude": 123.4}])
    assert pts[0].elevation_m == 123.4


def test_sample_gpx_file_has_elevation_stream():
    from app.importer.parsers import GpxTrackPointsParser
    sample = Path("../export/activities/18860139319.gpx")
    if not sample.exists():
        return
    parsed = GpxTrackPointsParser().parse(sample)
    aid = insert_activity([
        {"timestamp": p.timestamp, "elapsed_time_s": i, "distance_m": p.distance_m, "lat": p.lat, "lon": p.lon, "elevation_m": p.elevation_m}
        for i, p in enumerate(parsed)
    ], source_distance_m=699.0)
    res = TestClient(app).get(f"/activities/{aid}/streams?types=elevation").json()
    vals = [v for _, v in res["streams"]["elevation"] if v is not None]
    assert len(vals) > 100
    assert min(vals) > 90
    assert max(vals) < 110


def test_missing_elevation_and_invalid_pace_do_not_become_zero():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t, "elapsed_time_s": 0, "distance_m": 0, "elevation_m": None, "speed_mps": None},
        {"timestamp": t + timedelta(seconds=10), "elapsed_time_s": 10, "distance_m": 10, "elevation_m": None, "speed_mps": 0},
    ])
    res = TestClient(app).get(f"/activities/{aid}/streams?types=pace,elevation").json()
    assert res["x_domain_m"] == [0, 10.0]
    assert res["streams"]["elevation"] == [[0.0, None], [10.0, None]]
    assert res["streams"]["pace"] == [[0.0, None], [10.0, None]]


def test_smoothed_pace_stable_synthetic_run():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t + timedelta(seconds=i * 30), "elapsed_time_s": i * 30, "distance_m": i * 100, "elevation_m": 10}
        for i in range(11)
    ])
    res = TestClient(app).get(f"/activities/{aid}/streams?types=pace").json()
    assert res["x_domain_m"] == [0, 1000.0]
    assert res["streams"]["pace"][0] == [0.0, None]
    assert res["streams"]["pace"][-1] == [1000.0, None]
    pace = [v for _, v in res["streams"]["pace"] if v is not None]
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
    elev = [v for _, v in res["streams"]["elevation"] if v is not None]
    assert elev
    assert all(v >= 100 for v in elev)
    assert 0 not in elev


def test_elevation_stream_omits_minus_one_sentinel_and_all_missing_has_boundaries_only():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t + timedelta(seconds=i * 10), "elapsed_time_s": i * 10, "distance_m": i * 50, "elevation_m": -1}
        for i in range(4)
    ], source_distance_m=300)
    res = TestClient(app).get(f"/activities/{aid}/streams?types=elevation,heart_rate").json()
    assert res["x_domain_m"] == [0, 300.0]
    assert res["streams"]["elevation"] == [[0.0, None], [300.0, None]]
    assert all(v != -1 for _, v in res["streams"]["elevation"])


def test_stream_sparse_sensor_points_use_interpolated_distance():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t, "elapsed_time_s": 0, "distance_m": 0, "lat": -37.0, "lon": 145.0},
        {"timestamp": t + timedelta(seconds=5), "elapsed_time_s": 5, "distance_m": None, "heart_rate_bpm": 120, "elevation_m": 50, "cadence_spm": 170},
        {"timestamp": t + timedelta(seconds=6), "elapsed_time_s": 6, "distance_m": None, "elevation_m": 52},
        {"timestamp": t + timedelta(seconds=10), "elapsed_time_s": 10, "distance_m": 100, "lat": -37.0, "lon": 145.001},
    ], source_distance_m=100)
    res = TestClient(app).get(f"/activities/{aid}/streams?types=heart_rate,cadence,elevation").json()
    assert [50.0, 120.0] in res["streams"]["heart_rate"]
    assert [50.0, 170.0] in res["streams"]["cadence"]
    assert any(v is not None and v >= 50 for d, v in res["streams"]["elevation"])


def test_stream_domain_uses_source_distance_and_boundaries_when_values_start_late_end_early():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t, "elapsed_time_s": 0, "distance_m": 100, "heart_rate_bpm": 120},
        {"timestamp": t + timedelta(seconds=60), "elapsed_time_s": 60, "distance_m": 500, "heart_rate_bpm": 130},
    ], source_distance_m=1000)
    res = TestClient(app).get(f"/activities/{aid}/streams?types=heart_rate").json()
    assert res["x_domain_m"] == [0, 1000.0]
    assert res["streams"]["heart_rate"][0] == [0.0, None]
    assert res["streams"]["heart_rate"][-1] == [1000.0, None]
    assert [100.0, 120.0] in res["streams"]["heart_rate"]


def test_gpx_like_activity_has_pace_without_source_distance():
    t = datetime(2026, 1, 1, tzinfo=timezone.utc)
    aid = insert_activity([
        {"timestamp": t + timedelta(seconds=i * 30), "elapsed_time_s": i * 30, "distance_m": None, "lat": -37.0, "lon": 145.0 + i * 0.001}
        for i in range(8)
    ])
    res = TestClient(app).get(f"/activities/{aid}/streams?types=pace").json()
    assert res["streams"]["pace"]
    assert all(v > 0 for _, v in res["streams"]["pace"] if v is not None)
