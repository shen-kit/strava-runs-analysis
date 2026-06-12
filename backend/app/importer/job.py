from __future__ import annotations
import logging, shutil, zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from ..config import get_settings
from ..db import engine
from ..models import Activity, ActivityImportDiagnostic, ActivityRoute, ActivitySplit, BestEffort, ImportJob, TrackPoint
from .derive import clean_points, computed_distance_m, generate_best_efforts, generate_splits, mean, simplify_route
from .parsers import ParsedTrackPoint, activity_title_from_file, get_parser, suffix_key
from .strava_csv import RUN_SPORT_TYPES, StravaActivityRow, fallback_dedupe_key, file_sha256, read_activities_csv

logger = logging.getLogger(__name__)


@dataclass
class ActivityImportMetadata:
    source_activity_id: str | None
    title: str
    description: str | None
    sport_type: str
    filename: str | None
    activity_date_raw: str | None
    start_time_utc: datetime | None
    start_time_local: datetime | None
    local_date: object | None
    timezone: str | None
    source_distance_m: float | None
    moving_time_s: float | None
    elapsed_time_s: float | None
    elevation_gain_m: float | None
    avg_speed_mps: float | None
    max_speed_mps: float | None
    avg_heart_rate_bpm: float | None
    max_heart_rate_bpm: float | None
    avg_cadence_spm: float | None
    warnings: list[str]


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


def diag(job_id: int, meta: ActivityImportMetadata, status: str, parser_name=None, activity_id=None, raw=None, norm=None, cleaned=None, fields=None, dropped=None, warnings=None, error=None, file_hash=None, inferred_title=None, inferred_start_time=None, computed_distance=None, computed_duration=None, duplicate_reason=None) -> ActivityImportDiagnostic:
    return ActivityImportDiagnostic(
        import_job_id=job_id, activity_id=activity_id, source_activity_id=meta.source_activity_id, source_filename=meta.filename,
        parser_name=parser_name, file_hash=file_hash, inferred_title=inferred_title, inferred_start_time=inferred_start_time,
        computed_distance_m=computed_distance, computed_duration_s=computed_duration, duplicate_reason=duplicate_reason,
        parse_status=status, points_raw_count=raw, points_normalized_count=norm, points_cleaned_count=cleaned,
        fields_detected_json=fields, fields_dropped_json=dropped, warnings_json=warnings, error_message=error,
    )


def delete_activity(s: Session, activity: Activity) -> None:
    for cls in (TrackPoint, ActivitySplit, BestEffort, ActivityRoute):
        for obj in s.exec(select(cls).where(cls.activity_id == activity.id)).all():
            s.delete(obj)
    s.delete(activity)
    s.flush()


def metadata_from_strava_row(row: StravaActivityRow) -> ActivityImportMetadata:
    return ActivityImportMetadata(**row.__dict__)


def placeholder_metadata(filename: str) -> ActivityImportMetadata:
    return ActivityImportMetadata(
        source_activity_id=None, title=strip_activity_suffix(filename), description=None, sport_type="Run", filename=filename,
        activity_date_raw=None, start_time_utc=None, start_time_local=None, local_date=None, timezone=None,
        source_distance_m=None, moving_time_s=None, elapsed_time_s=None, elevation_gain_m=None, avg_speed_mps=None,
        max_speed_mps=None, avg_heart_rate_bpm=None, max_heart_rate_bpm=None, avg_cadence_spm=None, warnings=[],
    )


def strip_activity_suffix(filename: str) -> str:
    lower = filename.lower()
    for ext in (".gpx.gz", ".tcx.gz", ".fit.gz", ".gpx", ".tcx", ".fit"):
        if lower.endswith(ext):
            return filename[:-len(ext)].replace("_", " ")
    return Path(filename).stem.replace("_", " ")


def first_valid_timestamp(points: list[ParsedTrackPoint]) -> datetime | None:
    return next((p.timestamp for p in points if p.timestamp is not None), None)


def local_times(start: datetime | None, default_tz: str):
    tz = ZoneInfo(default_tz)
    if start is None:
        now = datetime.now(timezone.utc)
        local = now.astimezone(tz)
        return now, local, local.date(), default_tz, ["missing_start_time_used_now"]
    start_utc = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    local = start_utc.astimezone(tz)
    return start_utc, local, local.date(), default_tz, []


def moving_time_s(cleaned) -> float | None:
    if len(cleaned) < 2: return None
    total = 0.0
    for a, b in zip(cleaned, cleaned[1:]):
        if b.distance_m > a.distance_m:
            total += max(0.0, b.elapsed_time_s - a.elapsed_time_s)
    return total or None


def elevation_gain_m(cleaned) -> float | None:
    gain = 0.0
    found = False
    for a, b in zip(cleaned, cleaned[1:]):
        if a.elevation_m is None or b.elevation_m is None:
            continue
        found = True
        gain += max(0.0, b.elevation_m - a.elevation_m)
    return gain if found else None


def metadata_from_manual_file(path: Path, original_filename: str, points: list[ParsedTrackPoint], cleaned, default_tz: str) -> ActivityImportMetadata:
    inferred_title = activity_title_from_file(path)
    start = first_valid_timestamp(points)
    start_utc, start_local, local_date, tz, warnings = local_times(start, default_tz)
    comp = computed_distance_m(cleaned)
    moving = moving_time_s(cleaned)
    elapsed = cleaned[-1].elapsed_time_s if len(cleaned) >= 2 else None
    return ActivityImportMetadata(
        source_activity_id=None, title=inferred_title or strip_activity_suffix(original_filename), description=None, sport_type="Run",
        filename=original_filename, activity_date_raw=None, start_time_utc=start_utc, start_time_local=start_local, local_date=local_date,
        timezone=tz, source_distance_m=None, moving_time_s=moving, elapsed_time_s=elapsed, elevation_gain_m=elevation_gain_m(cleaned),
        avg_speed_mps=(comp / moving if comp and moving else None), max_speed_mps=max([p.speed_mps or 0 for p in points], default=None),
        avg_heart_rate_bpm=mean(p.heart_rate_bpm for p in cleaned), max_heart_rate_bpm=max([p.heart_rate_bpm for p in cleaned if p.heart_rate_bpm is not None], default=None),
        avg_cadence_spm=mean(p.cadence_spm for p in cleaned), warnings=warnings,
    )


def activity_start_for_compare(activity: Activity) -> datetime | None:
    return activity.start_time_utc or activity.start_time_local


def comparable_dt(dt: datetime | None) -> datetime | None:
    if dt is None: return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def find_fuzzy_duplicate(s: Session, meta: ActivityImportMetadata, comp_distance: float | None) -> tuple[Activity | None, str | None]:
    start = comparable_dt(meta.start_time_utc or meta.start_time_local)
    dist = meta.source_distance_m if meta.source_distance_m is not None else comp_distance
    dur = meta.moving_time_s if meta.moving_time_s is not None else meta.elapsed_time_s
    if start is None or dist is None or dur is None:
        return None, None
    for activity in s.exec(select(Activity)).all():
        other_start = comparable_dt(activity_start_for_compare(activity))
        other_dist = activity.source_distance_m if activity.source_distance_m is not None else activity.computed_distance_m
        other_dur = activity.moving_time_s if activity.moving_time_s is not None else activity.elapsed_time_s
        if other_start is None or other_dist is None or other_dur is None:
            continue
        if abs((other_start - start).total_seconds()) <= 60 and abs(other_dist - dist) <= 50 and abs(other_dur - dur) <= 60:
            return activity, f"fuzzy_duplicate:activity_id={activity.id}"
    return None, None


def import_single_activity_file(job_id: int, path: Path, *, original_filename: str | None = None, metadata: ActivityImportMetadata | None = None, force_reprocess: bool = False, delete_after_success: bool = False, allow_fuzzy_dedupe: bool = True) -> str:
    original_filename = original_filename or path.name
    hash_ = file_sha256(path)
    key = fallback_dedupe_key(metadata) if metadata and not metadata.source_activity_id else None
    placeholder = metadata or placeholder_metadata(original_filename)

    with Session(engine) as s:
        existing = None
        if metadata and metadata.source_activity_id:
            existing = s.exec(select(Activity).where(Activity.source_activity_id == metadata.source_activity_id)).one_or_none()
        elif key:
            existing = s.exec(select(Activity).where(Activity.fallback_dedupe_key == key)).one_or_none()
        if existing and existing.file_hash == hash_ and not force_reprocess:
            s.add(diag(job_id, placeholder, "skipped", activity_id=existing.id, file_hash=hash_, duplicate_reason="unchanged_file_hash", warnings=["unchanged_file_hash_skipped"]))
            s.commit(); return "skipped"
        if not existing and not (metadata and metadata.source_activity_id):
            hash_match = s.exec(select(Activity).where(Activity.file_hash == hash_)).first()
            if hash_match and not force_reprocess:
                s.add(diag(job_id, placeholder, "skipped", activity_id=hash_match.id, file_hash=hash_, duplicate_reason="file_hash", warnings=[f"duplicate_file_hash:activity_id={hash_match.id}"]))
                s.commit(); return "skipped"

    parser = get_parser(path)
    points = parser.parse(path)
    cleaned, clean_warnings, dropped = clean_points(points)
    comp = computed_distance_m(cleaned)
    inferred_title = activity_title_from_file(path)
    inferred_start = first_valid_timestamp(points)
    meta = metadata or metadata_from_manual_file(path, original_filename, points, cleaned, get_settings().default_timezone)
    meta.filename = original_filename
    warnings = list(meta.warnings) + list(clean_warnings)
    if meta.source_distance_m and comp and abs(meta.source_distance_m-comp)/max(meta.source_distance_m,1) > 0.1:
        warnings.append("distance_mismatch_source_vs_computed")
    splits, split_warnings = generate_splits(cleaned); warnings += split_warnings
    efforts, effort_warnings = generate_best_efforts(cleaned); warnings += effort_warnings
    route = simplify_route(cleaned)
    if route is None: warnings.append("route_not_available")
    elapsed = elapsed_for_points(points)

    with Session(engine) as s:
        existing2 = None
        if meta.source_activity_id:
            existing2 = s.exec(select(Activity).where(Activity.source_activity_id == meta.source_activity_id)).one_or_none()
        elif key:
            existing2 = s.exec(select(Activity).where(Activity.fallback_dedupe_key == key)).one_or_none()
        if not existing2 and allow_fuzzy_dedupe and not force_reprocess:
            dup, reason = find_fuzzy_duplicate(s, meta, comp)
            if dup:
                s.add(diag(job_id, meta, "skipped", parser.parser_name, dup.id, len(points), len(points), len(cleaned), fields_detected(points), dropped, warnings + [reason], file_hash=hash_, inferred_title=inferred_title or meta.title, inferred_start_time=inferred_start, computed_distance=comp, computed_duration=meta.moving_time_s or meta.elapsed_time_s, duplicate_reason=reason))
                s.commit(); return "skipped"
        status = "reprocessed" if existing2 else "new"
        try:
            if existing2:
                delete_activity(s, existing2)
                status = "reprocessed"
            distance_for_pace = meta.source_distance_m if meta.source_distance_m is not None else comp
            activity = Activity(
                source_activity_id=meta.source_activity_id, fallback_dedupe_key=key, source_filename=meta.filename, file_hash=hash_,
                title=meta.title, description=meta.description, source_sport_type=meta.sport_type, normalized_sport_type="run", start_time_utc=meta.start_time_utc,
                start_time_local=meta.start_time_local, local_date=meta.local_date, timezone=meta.timezone, source_distance_m=meta.source_distance_m,
                computed_distance_m=comp, moving_time_s=meta.moving_time_s, elapsed_time_s=meta.elapsed_time_s, elevation_gain_m=meta.elevation_gain_m,
                avg_pace_s_per_km=(meta.moving_time_s/(distance_for_pace/1000) if meta.moving_time_s and distance_for_pace else None),
                avg_speed_mps=meta.avg_speed_mps, max_speed_mps=meta.max_speed_mps, avg_heart_rate_bpm=meta.avg_heart_rate_bpm,
                max_heart_rate_bpm=meta.max_heart_rate_bpm, avg_cadence_spm=meta.avg_cadence_spm, updated_at=datetime.now(timezone.utc),
            )
            s.add(activity); s.flush()
            for i,p in enumerate(points):
                s.add(TrackPoint(activity_id=activity.id, point_index=i, timestamp=p.timestamp, elapsed_time_s=elapsed[i], distance_m=p.distance_m, lat=p.lat, lon=p.lon, elevation_m=p.elevation_m, heart_rate_bpm=p.heart_rate_bpm, cadence_spm=p.cadence_spm, speed_mps=p.speed_mps))
            for sp in splits: s.add(ActivitySplit(activity_id=activity.id, **sp))
            for ef in efforts: s.add(BestEffort(activity_id=activity.id, **ef))
            if route: s.add(ActivityRoute(activity_id=activity.id, **route))
            s.add(diag(job_id, meta, "success", parser.parser_name, activity.id, len(points), len(points), len(cleaned), fields_detected(points), dropped, warnings, file_hash=hash_, inferred_title=inferred_title or meta.title, inferred_start_time=inferred_start, computed_distance=comp, computed_duration=meta.moving_time_s or meta.elapsed_time_s))
            s.commit()
            if delete_after_success:
                path.unlink(missing_ok=True)
            return status
        except IntegrityError:
            s.rollback(); raise


def import_one_activity(job_id: int, row: StravaActivityRow, root: Path, force_reprocess_all: bool = False, force_reprocess_extensions: set[str] | None = None) -> str:
    path = resolve_activity_file(root, row.filename)
    meta = metadata_from_strava_row(row)
    if not path:
        with Session(engine) as s:
            s.add(diag(job_id, meta, "failed", error="activity file missing")); s.commit()
        raise FileNotFoundError(f"activity file missing: {row.filename}")
    ext = suffix_key(path).removesuffix(".gz").lstrip(".")
    force_reprocess = force_reprocess_all or ext in (force_reprocess_extensions or set())
    return import_single_activity_file(job_id, path, original_filename=row.filename or path.name, metadata=meta, force_reprocess=force_reprocess, allow_fuzzy_dedupe=True)


def safe_extract(zip_path: Path, dest: Path) -> None:
    with zipfile.ZipFile(zip_path) as z:
        base = dest.resolve()
        for member in z.infolist():
            out = (dest / member.filename).resolve()
            if not str(out).startswith(str(base)):
                raise ValueError("unsafe ZIP path")
        z.extractall(dest)


def process_import_job(job_id: int, zip_path: Path, tmp_dir: Path, force_reprocess_all: bool = False, force_reprocess_extensions: set[str] | None = None) -> None:
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
                result = import_one_activity(job_id, row, root, force_reprocess_all, force_reprocess_extensions)
                inc = {"processed_count":1}
                if result == "new": inc["new_count"] = 1
                elif result == "skipped": inc["skipped_count"] = 1
                elif result == "reprocessed": inc["reprocessed_count"] = 1
                inc_job(job_id, **inc)
            except Exception as e:
                logger.exception("Activity import failed", extra={"title":row.title,"source_activity_id":row.source_activity_id,"source_filename":row.filename})
                with Session(engine) as s:
                    s.add(diag(job_id, metadata_from_strava_row(row), "failed", error=str(e))); s.commit()
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


def process_activity_files_job(job_id: int, file_paths: list[Path], tmp_dir: Path, original_filenames: list[str] | None = None) -> None:
    logger.info("Activity files import job start", extra={"import_job_id": job_id})
    set_job(job_id, status="processing", started_at=datetime.now(timezone.utc), run_activities_seen=len(file_paths))
    try:
        for i, path in enumerate(file_paths):
            original = original_filenames[i] if original_filenames and i < len(original_filenames) else path.name
            try:
                result = import_single_activity_file(job_id, path, original_filename=original, delete_after_success=True)
                inc = {"processed_count": 1}
                if result == "new": inc["new_count"] = 1
                elif result == "skipped": inc["skipped_count"] = 1
                elif result == "reprocessed": inc["reprocessed_count"] = 1
                inc_job(job_id, **inc)
            except Exception as e:
                logger.exception("Activity file import failed", extra={"source_filename": original})
                meta = placeholder_metadata(original)
                with Session(engine) as s:
                    s.add(diag(job_id, meta, "failed", error=str(e))); s.commit()
                inc_job(job_id, processed_count=1, failed_count=1)
        set_job(job_id, status="completed", completed_at=datetime.now(timezone.utc))
    except Exception:
        logger.exception("Activity files import job failed", extra={"import_job_id": job_id})
        set_job(job_id, status="failed", error_message="Activity file import failed unexpectedly. Check backend logs for details.", completed_at=datetime.now(timezone.utc))
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            logger.exception("Import cleanup failed", extra={"import_job_id": job_id})
