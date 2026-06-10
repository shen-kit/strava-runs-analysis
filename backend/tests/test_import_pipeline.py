import csv, shutil, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pytest
from sqlmodel import Session, SQLModel, select

from app.db import engine, init_db
from app.models import Activity, ImportJob
from app.importer.parsers import GpxTrackPointsParser, TcxTrackPointsParser, FitTrackPointsParser, ParsedTrackPoint
from app.importer.strava_csv import read_activities_csv
from app.importer.derive import clean_points, computed_distance_m, generate_splits, generate_best_efforts, simplify_route
from app.importer.job import process_import_job


def setup_function():
    SQLModel.metadata.drop_all(engine)
    init_db()


def make_gpx(path: Path):
    path.write_text('''<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><trkseg>
<trkpt lat="-37.0" lon="145.0"><ele>10</ele><time>2026-01-01T00:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="-37.0" lon="145.009" ><ele>12</ele><time>2026-01-01T00:05:00Z</time></trkpt>
</trkseg></trk></gpx>''')


def make_tcx(path: Path):
    path.write_text('''<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap><Track>
<Trackpoint><Time>2026-01-01T00:00:00Z</Time><Position><LatitudeDegrees>-37</LatitudeDegrees><LongitudeDegrees>145</LongitudeDegrees></Position><AltitudeMeters>10</AltitudeMeters><HeartRateBpm><Value>121</Value></HeartRateBpm><Cadence>86</Cadence></Trackpoint>
<Trackpoint><Time>2026-01-01T00:05:00Z</Time><Position><LatitudeDegrees>-37</LatitudeDegrees><LongitudeDegrees>145.009</LongitudeDegrees></Position><AltitudeMeters>12</AltitudeMeters></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>''')


def test_csv_parses_runs_and_skips_non_runs(tmp_path, caplog):
    p = tmp_path / "activities.csv"
    with p.open("w", newline="") as f:
        w = csv.writer(f); w.writerow(["Activity ID","Activity Date","Activity Name","Activity Type","Filename","Distance","Moving Time","Elapsed Time"])
        w.writerow(["1","Jan 1, 2026, 12:00:00 AM","Run A","Run","activities/a.gpx","1000","300","310"])
        w.writerow(["2","Jan 2, 2026, 12:00:00 AM","Lift A","Weight Training","","0","0","0"])
    rows, warnings = read_activities_csv(p, "Australia/Melbourne")
    assert len(rows) == 2
    assert rows[0].sport_type == "Run" and rows[0].filename == "activities/a.gpx"
    assert rows[1].sport_type == "Weight Training"


def test_gpx_and_tcx_parsing(tmp_path):
    gpx = tmp_path / "a.gpx"; tcx = tmp_path / "a.tcx"
    make_gpx(gpx); make_tcx(tcx)
    gp = GpxTrackPointsParser().parse(gpx); tp = TcxTrackPointsParser().parse(tcx)
    assert gp[0].timestamp and gp[0].lat == -37.0 and gp[0].heart_rate_bpm == 120 and gp[0].cadence_spm == 170
    assert tp[0].timestamp and tp[0].lon == 145.0 and tp[0].heart_rate_bpm == 121 and tp[0].cadence_spm == 172


def test_fit_parser_sample_if_available():
    sample = Path("../export/activities/19971844108.fit.gz")
    if not sample.exists(): pytest.skip("sample FIT not available")
    pts = FitTrackPointsParser().parse(sample)
    assert len(pts) > 10
    assert any(p.timestamp for p in pts)


def test_cleaning_distance_splits_efforts_route():
    t = datetime(2026,1,1,tzinfo=timezone.utc)
    pts = [
        ParsedTrackPoint(t, -37, 145, 0),
        ParsedTrackPoint(t, -37, 145, 0),  # duplicate timestamp
        ParsedTrackPoint(t+timedelta(seconds=300), -37, 145.009, 2),
        ParsedTrackPoint(t+timedelta(seconds=301), -30, 150, 2),  # spike
        ParsedTrackPoint(t+timedelta(seconds=600), -37, 145.018, 4),
    ]
    cleaned, warnings, dropped = clean_points(pts)
    assert len(cleaned) == 3
    assert "non_increasing_timestamp" in dropped and "gps_spike_impossible_speed" in dropped
    assert computed_distance_m(cleaned) and computed_distance_m(cleaned) > 1500
    splits, _ = generate_splits(cleaned); assert splits and splits[0]["distance_m"] == 1000
    efforts, _ = generate_best_efforts(cleaned); assert any(e["distance_m"] == 400 for e in efforts)
    route = simplify_route(cleaned); assert route and isinstance(route["simplified_points_json"][0], list) and len(route["simplified_points_json"][0]) == 3


def build_zip(tmp_path: Path, bad_second=False):
    root = tmp_path / "export"; acts = root / "activities"; acts.mkdir(parents=True)
    make_gpx(acts / "a.gpx")
    if not bad_second: make_gpx(acts / "b.gpx")
    with (root / "activities.csv").open("w", newline="") as f:
        w=csv.writer(f); w.writerow(["Activity ID","Activity Date","Activity Name","Activity Type","Filename","Distance","Moving Time","Elapsed Time","Elevation Gain"])
        w.writerow(["1","Jan 1, 2026, 12:00:00 AM","Run A","Run","activities/a.gpx","1000","300","310","10"])
        w.writerow(["2","Jan 2, 2026, 12:00:00 AM","Lift A","Weight Training","","0","0","0","0"])
        w.writerow(["3","Jan 3, 2026, 12:00:00 AM","Run B","Run","activities/b.gpx","1000","300","310","10"])
    z = tmp_path / "export.zip"
    with zipfile.ZipFile(z, "w") as zipf:
        for p in root.rglob("*"):
            zipf.write(p, p.relative_to(root))
    return z


def run_zip(z: Path, tmp_path: Path):
    tmp = tmp_path / "jobtmp"; tmp.mkdir(exist_ok=True)
    upload = tmp / "upload.zip"; shutil.copy(z, upload)
    with Session(engine) as s:
        job = ImportJob(); s.add(job); s.commit(); s.refresh(job); jid = job.id
    process_import_job(jid, upload, tmp)
    with Session(engine) as s:
        return s.get(ImportJob, jid)


def test_dedupe_and_failure_policy(tmp_path):
    z = build_zip(tmp_path)
    job1 = run_zip(z, tmp_path)
    assert job1.new_count == 2 and job1.skipped_non_run_activities_count == 1 and job1.failed_count == 0
    job2 = run_zip(z, tmp_path)
    assert job2.skipped_count == 2 and job2.new_count == 0
    with Session(engine) as s: assert len(s.exec(select(Activity)).all()) == 2

    SQLModel.metadata.drop_all(engine); init_db()
    bad = build_zip(tmp_path / "bad", bad_second=True)
    job3 = run_zip(bad, tmp_path / "bad")
    assert job3.new_count == 1 and job3.failed_count == 1 and job3.status == "completed"
