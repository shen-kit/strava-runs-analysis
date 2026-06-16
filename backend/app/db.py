from collections.abc import Generator
from pathlib import Path
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine
from .config import get_settings

settings = get_settings()
if settings.database_url.startswith("sqlite:///./"):
    Path(settings.database_url.replace("sqlite:///./", "")).parent.mkdir(
        parents=True, exist_ok=True
    )
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
)


@event.listens_for(engine, "connect")
def set_sqlite_pragmas(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
