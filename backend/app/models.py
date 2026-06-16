from datetime import date, datetime, timezone
from typing import Optional
from sqlmodel import Field, SQLModel, Column, JSON, UniqueConstraint, Index
from sqlalchemy import Text


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ImportJob(SQLModel, table=True):
    __tablename__ = "import_jobs"
    id: Optional[int] = Field(default=None, primary_key=True)
    status: str = Field(default="pending", index=True)
    run_activities_seen: int = 0
    processed_count: int = 0
    new_count: int = 0
    skipped_count: int = 0
    reprocessed_count: int = 0
    failed_count: int = 0
    skipped_non_run_activities_count: int = 0
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class Activity(SQLModel, table=True):
    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("source_activity_id", name="uq_activities_source_activity_id"),
        UniqueConstraint(
            "fallback_dedupe_key", name="uq_activities_fallback_dedupe_key"
        ),
        Index("ix_activities_local_date", "local_date"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    source_system: str = "strava_export"
    source_activity_id: Optional[str] = Field(default=None, index=True)
    fallback_dedupe_key: Optional[str] = Field(default=None, index=True)
    source_filename: Optional[str] = None
    file_hash: Optional[str] = Field(default=None, index=True)
    title: str
    description: Optional[str] = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )
    source_sport_type: str
    normalized_sport_type: str = "run"
    start_time_utc: Optional[datetime] = None
    start_time_local: Optional[datetime] = None
    local_date: date
    timezone: Optional[str] = None
    source_distance_m: Optional[float] = None
    computed_distance_m: Optional[float] = None
    moving_time_s: Optional[float] = None
    elapsed_time_s: Optional[float] = None
    elevation_gain_m: Optional[float] = None
    avg_pace_s_per_km: Optional[float] = None
    avg_speed_mps: Optional[float] = None
    max_speed_mps: Optional[float] = None
    avg_heart_rate_bpm: Optional[float] = None
    max_heart_rate_bpm: Optional[float] = None
    avg_cadence_spm: Optional[float] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class TrackPoint(SQLModel, table=True):
    __tablename__ = "track_points"
    __table_args__ = (
        Index("ix_track_points_activity_index", "activity_id", "point_index"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(
        foreign_key="activities.id", index=True, ondelete="CASCADE"
    )
    point_index: int
    timestamp: Optional[datetime] = None
    elapsed_time_s: Optional[float] = None
    distance_m: Optional[float] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    elevation_m: Optional[float] = None
    heart_rate_bpm: Optional[float] = None
    cadence_spm: Optional[float] = None
    speed_mps: Optional[float] = None


class ActivitySplit(SQLModel, table=True):
    __tablename__ = "activity_splits"
    __table_args__ = (
        Index(
            "ix_activity_splits_activity", "activity_id", "split_type", "split_index"
        ),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(
        foreign_key="activities.id", index=True, ondelete="CASCADE"
    )
    split_type: str = "km"
    split_index: int
    start_distance_m: float
    end_distance_m: float
    distance_m: float
    duration_s: float
    avg_pace_s_per_km: Optional[float] = None
    avg_heart_rate_bpm: Optional[float] = None
    avg_cadence_spm: Optional[float] = None


class AppSetting(SQLModel, table=True):
    __tablename__ = "app_settings"
    key: str = Field(primary_key=True)
    value_json: dict = Field(sa_column=Column(JSON))
    updated_at: datetime = Field(default_factory=utcnow)


class BestEffortDistance(SQLModel, table=True):
    __tablename__ = "best_effort_distances"
    id: Optional[int] = Field(default=None, primary_key=True)
    label: str
    distance_m: float = Field(index=True)
    enabled: bool = True
    sort_order: int = 0


class BestEffort(SQLModel, table=True):
    __tablename__ = "best_efforts"
    __table_args__ = (
        Index("ix_best_efforts_distance_duration", "distance_m", "duration_s"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(
        foreign_key="activities.id", index=True, ondelete="CASCADE"
    )
    distance_m: float
    duration_s: float
    pace_s_per_km: float
    start_elapsed_time_s: Optional[float] = None
    end_elapsed_time_s: Optional[float] = None
    start_distance_m: Optional[float] = None
    end_distance_m: Optional[float] = None
    start_lat: Optional[float] = None
    start_lon: Optional[float] = None
    end_lat: Optional[float] = None
    end_lon: Optional[float] = None


class ActivityRoute(SQLModel, table=True):
    __tablename__ = "activity_routes"
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(
        foreign_key="activities.id", index=True, unique=True, ondelete="CASCADE"
    )
    simplified_points_json: list = Field(sa_column=Column(JSON))
    original_point_count: int
    simplified_point_count: int
    simplification_tolerance_m: float


class ActivityImportDiagnostic(SQLModel, table=True):
    __tablename__ = "activity_import_diagnostics"
    id: Optional[int] = Field(default=None, primary_key=True)
    import_job_id: int = Field(
        foreign_key="import_jobs.id", index=True, ondelete="CASCADE"
    )
    activity_id: Optional[int] = Field(
        default=None, foreign_key="activities.id", index=True, ondelete="SET NULL"
    )
    source_activity_id: Optional[str] = Field(default=None, index=True)
    source_filename: Optional[str] = None
    parser_name: Optional[str] = None
    file_hash: Optional[str] = Field(default=None, index=True)
    inferred_title: Optional[str] = None
    inferred_start_time: Optional[datetime] = None
    computed_distance_m: Optional[float] = None
    computed_duration_s: Optional[float] = None
    duplicate_reason: Optional[str] = None
    parse_status: str
    points_raw_count: Optional[int] = None
    points_normalized_count: Optional[int] = None
    points_cleaned_count: Optional[int] = None
    fields_detected_json: Optional[list] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    fields_dropped_json: Optional[list] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    warnings_json: Optional[list] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    error_message: Optional[str] = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )
    created_at: datetime = Field(default_factory=utcnow)
