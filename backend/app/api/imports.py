from __future__ import annotations
import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, select
from ..config import get_settings
from ..db import get_session
from ..models import ActivityImportDiagnostic, ImportJob
from ..importer.job import process_activity_files_job, process_import_job
from ..importer.parsers import suffix_key

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/strava-zip")
async def upload_strava_zip(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    force_reprocess_all: bool = Form(False),
    force_reprocess_extensions: str = Form(""),
    session: Session = Depends(get_session),
):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload must be a ZIP file")
    settings = get_settings()
    tmp_dir = Path(settings.import_tmp_dir) / str(uuid.uuid4())
    tmp_dir.mkdir(parents=True, exist_ok=True)
    zip_path = tmp_dir / "upload.zip"
    with zip_path.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
    job = ImportJob(status="pending")
    session.add(job); session.commit(); session.refresh(job)
    extensions = {x.strip().lower().lstrip(".") for x in force_reprocess_extensions.split(",") if x.strip()}
    extensions = {x for x in extensions if x in {"gpx", "fit", "tcx"}}
    background_tasks.add_task(process_import_job, job.id, zip_path, tmp_dir, force_reprocess_all, extensions)
    return {"id": job.id, "status": job.status}


@router.post("/activity-files")
async def upload_activity_files(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
):
    if not files:
        raise HTTPException(status_code=400, detail="At least one activity file is required")
    allowed = {".gpx", ".tcx", ".fit", ".gpx.gz", ".tcx.gz", ".fit.gz"}
    for file in files:
        if not file.filename or suffix_key(Path(file.filename)) not in allowed:
            raise HTTPException(status_code=400, detail=f"Unsupported activity file: {file.filename}")
    settings = get_settings()
    tmp_dir = Path(settings.import_tmp_dir) / str(uuid.uuid4())
    tmp_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    names: list[str] = []
    for i, file in enumerate(files):
        name = Path(file.filename or f"activity-{i}").name
        path = tmp_dir / f"{i}-{name}"
        with path.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                out.write(chunk)
        paths.append(path); names.append(name)
    job = ImportJob(status="pending")
    session.add(job); session.commit(); session.refresh(job)
    background_tasks.add_task(process_activity_files_job, job.id, paths, tmp_dir, names)
    return {"id": job.id, "status": job.status}


@router.get("/{import_job_id}")
def get_import(import_job_id: int, session: Session = Depends(get_session)):
    job = session.get(ImportJob, import_job_id)
    if not job: raise HTTPException(status_code=404, detail="Import job not found")
    out = {k: getattr(job,k) for k in ["status","run_activities_seen","processed_count","new_count","skipped_count","reprocessed_count","failed_count","skipped_non_run_activities_count","error_message"]}
    rows = session.exec(select(ActivityImportDiagnostic).where(ActivityImportDiagnostic.import_job_id == import_job_id).order_by(ActivityImportDiagnostic.id)).all()
    out["diagnostics"] = [{
        "source_filename": d.source_filename,
        "parser_name": d.parser_name,
        "parse_status": d.parse_status,
        "file_hash": d.file_hash,
        "inferred_title": d.inferred_title,
        "inferred_start_time": d.inferred_start_time,
        "computed_distance_m": d.computed_distance_m,
        "computed_duration_s": d.computed_duration_s,
        "duplicate_reason": d.duplicate_reason,
        "warnings": d.warnings_json,
        "error_message": d.error_message,
    } for d in rows]
    return out
