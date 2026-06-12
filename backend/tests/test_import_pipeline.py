import csv, shutil, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from sqlmodel import Session, SQLModel, select

from app.db import engine, init_db
from app.models import Activity, ActivityImportDiagnostic, ImportJob
from app.importer.parsers import GpxTrackPointsParser, TcxTrackPointsParser, ParsedTrackPoint, suffix_key
from app.importer.strava_csv import read_activities_csv
from app.importer.derive import clean_points, computed_distance_m, generate_splits, generate_best_efforts, simplify_route
from app.importer.job import import_single_activity_file, process_import_job
from app.api.stats import distance_distribution, long_run_progression, summary, totals


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


def make_named_gpx(path: Path, name: str | None = None, start="2026-01-01T00:00:00Z", end="2026-01-01T00:05:00Z", lon2="145.009", extra=""):
    name_xml = f"<name>{name}</name>" if name else ""
    path.write_text(f'''<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk>{name_xml}<trkseg>
<trkpt lat="-37.0" lon="145.0"><ele>10</ele><time>{start}</time></trkpt>
<trkpt lat="-37.0" lon="{lon2}"><ele>12</ele><time>{end}</time></trkpt>
</trkseg></trk>{extra}</gpx>''')


def make_job() -> int:
    with Session(engine) as s:
        job = ImportJob(); s.add(job); s.commit(); s.refresh(job); return job.id


def test_csv_parses_runs_and_skips_non_runs(tmp_path):
    p = tmp_path / "activities.csv"
    with p.open("w", newline="") as f:
        w = csv.writer(f); w.writerow(["Activity ID","Activity Date","Activity Name","Activity Type","Filename","Distance","Moving Time","Elapsed Time"])
        w.writerow(["1","Jan 1, 2026, 12:00:00 AM","Run A","Run","activities/a.gpx","1000","300","310"])
        w.writerow(["2","Jan 2, 2026, 12:00:00 AM","Lift A","Weight Training","","0","0","0"])
    rows, warnings = read_activities_csv(p, "Australia/Melbourne")
    assert len(rows) == 2
    assert rows[0].sport_type == "Run" and rows[0].filename == "activities/a.gpx"
    assert rows[1].sport_type == "Weight Training"


def test_suffix_key_supports_compressed_variants():
    assert suffix_key(Path("a.gpx.gz")).removesuffix(".gz").lstrip(".") == "gpx"
    assert suffix_key(Path("a.fit.gz")).removesuffix(".gz").lstrip(".") == "fit"
    assert suffix_key(Path("a.tcx.gz")).removesuffix(".gz").lstrip(".") == "tcx"


def test_gpx_and_tcx_parsing(tmp_path):
    gpx = tmp_path / "a.gpx"; tcx = tmp_path / "a.tcx"
    make_gpx(gpx); make_tcx(tcx)
    gp = GpxTrackPointsParser().parse(gpx); tp = TcxTrackPointsParser().parse(tcx)
    assert gp[0].timestamp and gp[0].lat == -37.0 and gp[0].elevation_m == 10 and gp[0].heart_rate_bpm == 120 and gp[0].cadence_spm == 170
    assert tp[0].timestamp and tp[0].lon == 145.0 and tp[0].elevation_m == 10 and tp[0].heart_rate_bpm == 121 and tp[0].cadence_spm == 172


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


def run_zip(z: Path, tmp_path: Path, force_all=False, force_ext=None):
    tmp = tmp_path / "jobtmp"; tmp.mkdir(exist_ok=True)
    upload = tmp / "upload.zip"; shutil.copy(z, upload)
    with Session(engine) as s:
        job = ImportJob(); s.add(job); s.commit(); s.refresh(job); jid = job.id
    process_import_job(jid, upload, tmp, force_all, set(force_ext or []))
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


def test_force_reprocess_all_and_extensions(tmp_path):
    z = build_zip(tmp_path)
    first = run_zip(z, tmp_path)
    assert first.new_count == 2
    forced_all = run_zip(z, tmp_path, force_all=True)
    assert forced_all.reprocessed_count == 2 and forced_all.skipped_count == 0
    forced_gpx = run_zip(z, tmp_path, force_ext=["gpx"])
    assert forced_gpx.reprocessed_count == 2 and forced_gpx.skipped_count == 0


def test_manual_file_title_falls_back_to_filename(tmp_path):
    p = tmp_path / "Lunch_run.gpx"
    make_named_gpx(p)
    assert import_single_activity_file(make_job(), p, original_filename=p.name) == "new"
    with Session(engine) as s:
        a = s.exec(select(Activity)).one()
        assert a.title == "Lunch run"
        assert a.source_sport_type == "Run"
        assert a.source_distance_m is None and a.computed_distance_m


def test_manual_file_title_uses_activity_name(tmp_path):
    p = tmp_path / "file-name.gpx"
    make_named_gpx(p, name="Track title")
    assert import_single_activity_file(make_job(), p, original_filename=p.name) == "new"
    with Session(engine) as s:
        assert s.exec(select(Activity)).one().title == "Track title"


def test_manual_exact_file_hash_duplicate_skipped(tmp_path):
    p = tmp_path / "dup.gpx"
    make_named_gpx(p)
    assert import_single_activity_file(make_job(), p, original_filename=p.name) == "new"
    assert import_single_activity_file(make_job(), p, original_filename=p.name) == "skipped"
    with Session(engine) as s:
        assert len(s.exec(select(Activity)).all()) == 1
        diag = s.exec(select(ActivityImportDiagnostic).where(ActivityImportDiagnostic.parse_status == "skipped")).one()
        assert diag.duplicate_reason == "file_hash"


def test_manual_fuzzy_duplicate_skipped_with_different_hash(tmp_path):
    a = tmp_path / "a.gpx"; b = tmp_path / "b.gpx"
    make_named_gpx(a)
    make_named_gpx(b, extra="<!-- different hash -->")
    assert import_single_activity_file(make_job(), a, original_filename=a.name) == "new"
    assert import_single_activity_file(make_job(), b, original_filename=b.name) == "skipped"
    with Session(engine) as s:
        assert len(s.exec(select(Activity)).all()) == 1
        diag = s.exec(select(ActivityImportDiagnostic).where(ActivityImportDiagnostic.parse_status == "skipped")).one()
        assert diag.duplicate_reason and diag.duplicate_reason.startswith("fuzzy_duplicate")


def test_manual_nearby_non_duplicate_imported(tmp_path):
    a = tmp_path / "a.gpx"; b = tmp_path / "b.gpx"
    make_named_gpx(a)
    make_named_gpx(b, lon2="145.011", extra="<!-- different distance beyond tolerance -->")
    assert import_single_activity_file(make_job(), a, original_filename=a.name) == "new"
    assert import_single_activity_file(make_job(), b, original_filename=b.name) == "new"
    with Session(engine) as s:
        assert len(s.exec(select(Activity)).all()) == 2


def test_dashboard_stats_use_computed_distance_for_manual_imports(tmp_path):
    p = tmp_path / "manual_run.gpx"
    make_named_gpx(p)
    assert import_single_activity_file(make_job(), p, original_filename=p.name) == "new"
    with Session(engine) as s:
        a = s.exec(select(Activity)).one()
        assert a.source_distance_m is None and a.computed_distance_m and a.computed_distance_m > 700
        summ = summary(s)
        assert summ["total_distance_m"] == a.computed_distance_m
        assert summ["longest_run_distance_m"] == a.computed_distance_m
        assert summ["average_pace_s_per_km"] is not None
        total_rows = totals("week", s)
        assert total_rows and total_rows[0]["distance_m"] == a.computed_distance_m
        long_rows = long_run_progression("week", s)
        assert long_rows and long_rows[0]["longest_run_distance_m"] == a.computed_distance_m
        distribution_rows = distance_distribution(s)
        assert sum(row["distance_m"] for row in distribution_rows) == a.computed_distance_m
