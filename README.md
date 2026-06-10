# Running Tracker

A local-first Strava running analytics dashboard. Import a Strava bulk export ZIP, store runs in SQLite, and explore training volume, personal bests, routes, streams, and activity details.

This project is a work in progress. It is intended for personal/self-hosted use and currently has no authentication.

## Features

- Import Strava bulk export ZIP files.
- Import only run-like activities (`Run`, `TrailRun`, `VirtualRun`).
- Safe repeat imports with deduplication by activity ID and file hash.
- Optional force reprocessing for all activities or selected file types (`GPX`, `FIT`, `TCX`, including `.gz` variants).
- Dashboard with:
  - summary totals
  - weekly/monthly training volume
  - consistency charts
  - personal bests
  - best-effort trends
  - long-run progression
  - pace trends
  - distance distribution
  - recent runs
- Activity detail pages with:
  - route map
  - satellite raster basemap via MapLibre GL
  - route overlays for pace, heart rate, gradient, and cadence
  - start/finish/pause markers
  - splits
  - best efforts
  - pace/elevation/HR/cadence charts
  - source vs computed distance debugging
- Local SQLite database stored under `./data/app.db`.

## Quick start

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env`. At minimum, set map tile values if you want the satellite map to work.
    - Go to https://cloud.maptiler.com and create an account
    - Go to https://cloud.maptiler.com/account/keys/ and copy the default key into the `<YOUR KEY HERE>` section of the `.env.template` file

3. Start the app:

```bash
docker compose up --build
```

4. Open http://localhost:3000 in your browser

After the first build, normal usage is usually:

```bash
docker compose up
```

## Environment setup

The app uses `.env` at the repository root.

Important values:

```env
DATABASE_URL=sqlite:////data/app.db
IMPORT_TMP_DIR=/data/imports_tmp
CORS_ALLOWED_ORIGINS=http://localhost:3000
DEFAULT_TIMEZONE=Australia/Melbourne
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_MAP_TILE_URL=https://example.com/satellite/{z}/{x}/{y}.jpg
NEXT_PUBLIC_MAP_ATTRIBUTION=Satellite imagery attribution
```

### Map tiles / Mapbox setup

The map uses MapLibre GL with a raster tile URL template. It does not use Leaflet and does not manually request tiles by latitude/longitude.

You need a tile URL in `{z}/{x}/{y}` format. For Mapbox raster satellite tiles, this usually looks like:

```env
NEXT_PUBLIC_MAP_TILE_URL=https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=YOUR_MAPBOX_TOKEN
NEXT_PUBLIC_MAP_ATTRIBUTION=© Mapbox © OpenStreetMap
```

Notes:

- Replace `YOUR_MAPBOX_TOKEN` with your Mapbox public access token.
- Check your provider’s attribution requirements.
- Some providers use `256` or `512` pixel tiles. The app currently uses `tileSize: 256`.
- The placeholder URL in `.env.example` will not load real imagery.

## Importing Strava data

1. Export your data from Strava as a bulk export ZIP.
    - Go to settings -> Delete my account
    - There will be an option to export all of your data
    - Download the ZIP file once you receive it in your email
2. Open http://localhost:3000/import.
3. Upload the ZIP.
4. Watch import progress.
5. Go to the dashboard or activities page after completion.

Import behavior:

- Only running activities are stored.
- Non-runs are skipped and counted.
- Existing unchanged activities are skipped.
- Changed files are reprocessed.
- Individual activity failures do not fail the whole import.
- Uploaded ZIP/extracted files are deleted after the import job finishes.

If you change parser logic or want to refresh stored derived data, use the import page’s force reprocess options.

## Data storage

Docker Compose bind-mounts `./data` into the backend container.

- SQLite DB: `./data/app.db`
- Temporary import files: `./data/imports_tmp/`

The frontend does not mount or read the database. All database access goes through the backend API.

## Developer Notes for Contributing

### Architecture

- Frontend: Next.js, TanStack Query, Recharts, MapLibre GL JS
- Backend: FastAPI
- Database: SQLite
- ORM/model layer: SQLModel / SQLAlchemy
- Migrations: Alembic
- Route map: MapLibre raster tile source + GeoJSON route layers
- Persistence: bind-mounted `./data`

No authentication is implemented. Browser calls FastAPI directly. Backend owns all database access.

### Docker development

`docker-compose.yml` is configured for hot reload:

- Backend runs `uvicorn app.main:app --reload`.
- Frontend runs `next dev`.
- Source directories are bind-mounted into containers.

Use:

```bash
docker compose up
```

Rebuild when dependencies or Dockerfiles change:

```bash
docker compose up --build
```

Ports bind to localhost only:

- `127.0.0.1:3000:3000`
- `127.0.0.1:8000:8000`

### Backend local development

Always activate the backend virtual environment before backend work:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL=sqlite:///../data/app.db IMPORT_TMP_DIR=../data/imports_tmp uvicorn app.main:app --reload
```

Run tests:

```bash
cd backend
source .venv/bin/activate
pytest
```

Alembic:

```bash
cd backend
source .venv/bin/activate
alembic upgrade head
```

The app also runs `SQLModel.metadata.create_all()` on startup for MVP convenience, but Alembic is set up and should be maintained for schema changes.

### Frontend local development

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

If testing maps locally, also provide:

```bash
NEXT_PUBLIC_MAP_TILE_URL='https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=YOUR_MAPBOX_TOKEN'
NEXT_PUBLIC_MAP_ATTRIBUTION='© Mapbox © OpenStreetMap'
```

### Backend endpoints

Core endpoints include:

- `POST /imports/strava-zip`
- `GET /imports/{id}`
- `GET /activities`
- `GET /activities/{id}`
- `GET /activities/{id}/route`
- `GET /activities/{id}/route-overlay?metric=pace|heart_rate|gradient|cadence`
- `GET /activities/{id}/splits`
- `GET /activities/{id}/best-efforts`
- `GET /activities/{id}/streams`
- `GET /stats/summary`
- `GET /stats/totals?bucket=week|month|year`
- `GET /stats/weekly-volume`
- `GET /stats/consistency`
- `GET /stats/personal-bests`
- `GET /stats/best-effort-trend`
- `GET /stats/long-run-progression`
- `GET /stats/distance-distribution`

API responses use numeric base metric units, for example metres, seconds, seconds/km, bpm, spm.

### Tests

Backend tests cover:

- CSV parsing
- GPX/TCX parser basics
- distance enrichment for GPS-only points
- sparse FIT-like sensor point interpolation
- elevation sentinel handling
- stream generation behavior
- cleaning and derived stats
- route simplification shape
- deduplication and force reprocess behavior
- failed activity continuation

Frontend tests are not currently implemented. Manual testing plus `npm run lint` and `npm run build` are used for the MVP.

### Known limitations

- No authentication.
- No multi-user support.
- No app-specific backup/export.
- FIT files can vary widely by device; parsing is best-effort.
- The map requires a valid external tile provider.
- Styling and analytics are still evolving.
