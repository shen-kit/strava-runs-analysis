# Running Tracker MVP

Local-first Strava running analytics dashboard.

## Stack

- Frontend: Next.js, TanStack Query, Recharts
- Backend: FastAPI, SQLModel/SQLAlchemy, Alembic
- DB: SQLite at `./data/app.db`
- Imports temp dir: `./data/imports_tmp/`

No auth. Backend owns DB access. Frontend calls FastAPI only.

## Docker Compose

```bash
cp .env.example .env
mkdir -p data/imports_tmp
docker compose up --build
```

After first build, code changes hot-reload:

- backend reloads via `uvicorn --reload`
- frontend reloads via `next dev`

Use `docker compose up` for normal dev. Rebuild only after dependency/Dockerfile changes.

Open:

- Frontend: http://localhost:3000
- Backend health: http://localhost:8000/health

Ports bind to `127.0.0.1`.

## Import Strava ZIP

1. Open http://localhost:3000/import
2. Upload Strava bulk export ZIP
3. Watch progress
4. Dashboard/activity pages update after completion

Import keeps only run-like activities: `Run`, `TrailRun`, `VirtualRun`. Non-runs are counted and logged as `Skipped activity: <title>`.

Repeated imports are safe: same source activity ID + file hash skips; changed file hash reprocesses.

Raw ZIP/extracted files are deleted after each job.

## Backend local dev

Always activate venv before backend work:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL=sqlite:///../data/app.db IMPORT_TMP_DIR=../data/imports_tmp uvicorn app.main:app --reload
```

Alembic:

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
```

The app also runs `SQLModel.metadata.create_all()` on startup for MVP convenience.

## Frontend local dev

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

## Tests

```bash
cd backend
source .venv/bin/activate
pytest
```

Tests cover CSV parsing, parsers, cleaning/derived stats, route simplification, dedupe basics, failed activity continuation.
