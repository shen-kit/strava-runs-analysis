import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import activities, imports, stats
from .config import get_settings
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
settings = get_settings()
app = FastAPI(title="Running Tracker API")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"status":"ok"}

app.include_router(imports.router)
app.include_router(activities.router)
app.include_router(stats.router)
