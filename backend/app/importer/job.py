from __future__ import annotations
import logging, shutil, zipfile
from datetime import datetime, timezone
from pathlib import Path
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from ..config import get_settings
from ..db import engine
from ..models import Activity, ActivityImportDiagnostic, ActivityRoute, ActivitySplit, BestEffort, ImportJob, TrackPoint
from .derive import clean_points, computed_distance_m, generate_best_efforts, generate_splits, simplify_route
from .parsers import ParsedTrackPoint, get_parser
from .strava_csv import RUN_SPORT_TYPES, StravaActivityRow, fallback_dedupe_key, file_sha256, read_activities_csv

logger = logging.getLogger(__name__)


def set_job(job_id: int, **values) -> None:
    with Session(engine) as s:
        job = s.get(ImportJob, job_id)
        if not job: return
        for k,v in values.items(): setattr(job,k,v)
        s.add(job); s.commit()


def inc_job(job_id: int, **incs) -> None:
    with Session(engine) as s:
        job = s.get(ImportJob, job_id)
        if not job: return
        for k,v in incs.items(): setattr(job,k,getattr(job,k)+v)
        s.add(job); s.commit()


def find_export_root(tmp_dir: Path) -> Path:
    hits = list(tmp_dir.rglob("activities.csv"))
    if not hits: raise FileNotFoundError("activities.csv not found in ZIP")
    return hits[0].parent


def resolve_activity_file(root: Path, filename: str | None) -> Path | None:
    if not filename: return None
    direct = root / filename
    if direct.exists(): return direct
    matches = list(root.rglob(Path(filename).name))
    return matches[0] if matches else None


def fields_detected(points: list[ParsedTrackPoint]) -> list[str]:
    fields=[]
    for name in ("timestamp","lat","lon","elevation_m","distance_m","heart_rate_bpm","cadence_spm","speed_mps"):
        if any(getattr(p,name) is not None for p in points): fields.append(name)
    return fields


def elapsed_for_points(points: list[ParsedTrackPoint]) -> list[float | None]:
    first = next((p.timestamp for p in points if p.timestamp is not None), None)
    return [((p.timestamp-first).total_seconds() if p.timestamp and first else None) for p in points]


def diag(job_id: int, row: StravaActivityRow, status: str, parser_name=None, activity_id=None, raw=None, norm=None, cleaned=None, fields=None, dropped=None, warnings=None, error=None) -> ActivityImportDiagnostic:
    return ActivityImportDiagnostic(import_job_id=job_id, activity_id=activity_id, source_activity_id=row.source_activity_id, source_filename=row.filename, parser_name=parser_name, parse_status=status, points_raw_count=raw, points_normalized_count=norm, points_cleaned_count=cleaned, fields_detected_json=fields, fields_dropped_json=dropped, warnings_json=warnings, error_message=error)


def delete_activity(s: Session, activity: Activity) -> None:
    for cls in (TrackPoint, ActivitySplit, BestEffort, ActivityRoute):
        for obj in s.exec(select(cls).where(cls.activity_id == activity.id)).all():
            s.delete(obj)
    s.delete(activity)
    s.flush()


def import_one_activity(job_id: int, row: StravaActivityRow, root: Path) -> str:
    path = resolve_activity_file(root, row.filename)
    if not path:
        with Session(engine) as s:
            s.add(diag(job_id, row, "failed", error="activity file missing")); s.commit()
        raise FileNotFoundError(f"activity file missing: {row.filename}")
    hash_ = file_sha256(path)
    key = fallback_dedupe_key(row) if not row.source_activity_id else None
    with Session(engine) as s:
        existing = None
        if row.source_activity_id:
            existing = s.exec(select(Activity).where(Activity.source_activity_id == row.source_activity_id)).one_or_none()
        elif key:
            existing = s.exec(select(Activity).where(Activity.fallback_dedupe_key == key)).one_or_none()
        if existing and existing.file_hash == hash_:
            s.add(diag(job_id,row,"skipped",activity_id=existing.id,parser_name=None,warnings=["unchanged_file_hash_skipped"]))
            s.commit(); return "skipped"

    parser = get_parser(path)
    points = parser.parse(path)
    cleaned, clean_warnings, dropped = clean_points(points)
    comp = computed_distance_m(cleaned)
    warnings = list(row.warnings) + list(clean_warnings)
    if row.source_distance_m and comp and abs(row.source_distance_m-comp)/max(row.source_distance_m,1) > 0.1:
        warnings.append("distance_mismatch_source_vs_computed")
    splits, split_warnings = generate_splits(cleaned); warnings += split_warnings
    efforts, effort_warnings = generate_best_efforts(cleaned); warnings += effort_warnings
    route = simplify_route(cleaned)
    if route is None: warnings.append("route_not_available")
    elapsed = elapsed_for_points(points)
    status = "reprocessed" if existing else "new"
    with Session(engine) as s:
        try:
            existing2 = None
            if row.source_activity_id:
                existing2 = s.exec(select(Activity).where(Activity.source_activity_id == row.source_activity_id)).one_or_none()
            elif key:
                existing2 = s.exec(select(Activity).where(Activity.fallback_dedupe_key == key)).one_or_none()
            if existing2:
                delete_activity(s, existing2)
                status = "reprocessed"
            activity = Activity(
                source_activity_id=row.source_activity_id, fallback_dedupe_key=key, source_filename=row.filename, file_hash=hash_,
                title=row.title, description=row.description, source_sport_type=row.sport_type, start_time_utc=row.start_time_utc,
                start_time_local=row.start_time_local, local_date=row.local_date, timezone=row.timezone, source_distance_m=row.source_distance_m,
                computed_distance_m=comp, moving_time_s=row.moving_time_s, elapsed_time_s=row.elapsed_time_s, elevation_gain_m=row.elevation_gain_m,
                avg_pace_s_per_km=(row.moving_time_s/(row.source_distance_m/1000) if row.moving_time_s and row.source_distance_m else None),
                avg_speed_mps=row.avg_speed_mps, max_speed_mps=row.max_speed_mps, avg_heart_rate_bpm=row.avg_heart_rate_bpm,
                max_heart_rate_bpm=row.max_heart_rate_bpm, avg_cadence_spm=row.avg_cadence_spm, updated_at=datetime.now(timezone.utc),
            )
            s.add(activity); s.flush()
            for i,p in enumerate(points):
                s.add(TrackPoint(activity_id=activity.id, point_index=i, timestamp=p.timestamp, elapsed_time_s=elapsed[i], distance_m=p.distance_m, lat=p.lat, lon=p.lon, elevation_m=p.elevation_m, heart_rate_bpm=p.heart_rate_bpm, cadence_spm=p.cadence_spm, speed_mps=p.speed_mps))
            for sp in splits: s.add(ActivitySplit(activity_id=activity.id, **sp))
            for ef in efforts: s.add(BestEffort(activity_id=activity.id, **ef))
            if route: s.add(ActivityRoute(activity_id=activity.id, **route))
            s.add(diag(job_id,row,"success",parser.parser_name,activity.id,len(points),len(points),len(cleaned),fields_detected(points),dropped,warnings))
            s.commit(); return status
        except IntegrityError:
            s.rollback(); raise


def safe_extract(zip_path: Path, dest: Path) -> None:
    with zipfile.ZipFile(zip_path) as z:
        base = dest.resolve()
        for member in z.infolist():
            out = (dest / member.filename).resolve()
            if not str(out).startswith(str(base)):
                raise ValueError("unsafe ZIP path")
        z.extractall(dest)


def process_import_job(job_id: int, zip_path: Path, tmp_dir: Path) -> None:
    settings = get_settings()
    logger.info("Import job start", extra={"import_job_id": job_id})
    set_job(job_id, status="processing", started_at=datetime.now(timezone.utc))
    try:
        extract_dir = tmp_dir / "extracted"; extract_dir.mkdir(parents=True, exist_ok=True)
        safe_extract(zip_path, extract_dir)
        root = find_export_root(extract_dir)
        rows, csv_warnings = read_activities_csv(root / "activities.csv", settings.default_timezone)
        run_rows = [r for r in rows if r.sport_type in RUN_SPORT_TYPES]
        set_job(job_id, run_activities_seen=len(run_rows))
        for row in rows:
            if row.sport_type not in RUN_SPORT_TYPES:
                logger.info("Skipped activity: %s", row.title, extra={"sport_type": row.sport_type})
                inc_job(job_id, skipped_non_run_activities_count=1)
                continue
            try:
                result = import_one_activity(job_id, row, root)
                inc = {"processed_count":1}
                if result == "new": inc["new_count"] = 1
                elif result == "skipped": inc["skipped_count"] = 1
                elif result == "reprocessed": inc["reprocessed_count"] = 1
                inc_job(job_id, **inc)
            except Exception as e:
                logger.exception("Activity import failed", extra={"title":row.title,"source_activity_id":row.source_activity_id,"source_filename":row.filename})
                # diag may already exist for missing file; add one if parser/import failed.
                with Session(engine) as s:
                    s.add(diag(job_id,row,"failed",error=str(e))); s.commit()
                inc_job(job_id, processed_count=1, failed_count=1)
        set_job(job_id, status="completed", completed_at=datetime.now(timezone.utc))
        logger.info("Import job completed", extra={"import_job_id": job_id})
    except Exception:
        logger.exception("Import job failed", extra={"import_job_id": job_id})
        set_job(job_id, status="failed", error_message="Import failed unexpectedly. Check backend logs for details.", completed_at=datetime.now(timezone.utc))
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            logger.exception("Import cleanup failed", extra={"import_job_id": job_id})
