from __future__ import annotations
import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlmodel import Session
from ..config import get_settings
from ..db import get_session
from ..models import ImportJob
from ..importer.job import process_import_job

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/strava-zip")
async def upload_strava_zip(background_tasks: BackgroundTasks, file: UploadFile = File(...), session: Session = Depends(get_session)):
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
    background_tasks.add_task(process_import_job, job.id, zip_path, tmp_dir)
    return {"id": job.id, "status": job.status}


@router.get("/{import_job_id}")
def get_import(import_job_id: int, session: Session = Depends(get_session)):
    job = session.get(ImportJob, import_job_id)
    if not job: raise HTTPException(status_code=404, detail="Import job not found")
    return {k: getattr(job,k) for k in ["status","run_activities_seen","processed_count","new_count","skipped_count","reprocessed_count","failed_count","skipped_non_run_activities_count","error_message"]}
