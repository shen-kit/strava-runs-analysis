"""add_settings

Revision ID: 7c2a9f4d8b11
Revises: 1d5793522c10
Create Date: 2026-06-11 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision = "7c2a9f4d8b11"
down_revision = "1d5793522c10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("value_json", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "best_effort_distances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_best_effort_distances_distance_m"),
        "best_effort_distances",
        ["distance_m"],
        unique=False,
    )
    defaults = [
        ("400m", 400.0),
        ("800m", 800.0),
        ("1km", 1000.0),
        ("1 mile", 1609.344),
        ("3km", 3000.0),
        ("5km", 5000.0),
        ("10km", 10000.0),
        ("15km", 15000.0),
        ("Half marathon", 21097.5),
        ("Marathon", 42195.0),
    ]
    table = sa.table(
        "best_effort_distances",
        sa.column("label"),
        sa.column("distance_m"),
        sa.column("enabled"),
        sa.column("sort_order"),
    )
    op.bulk_insert(
        table,
        [
            {"label": label, "distance_m": distance, "enabled": True, "sort_order": i}
            for i, (label, distance) in enumerate(defaults)
        ],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_best_effort_distances_distance_m"), table_name="best_effort_distances"
    )
    op.drop_table("best_effort_distances")
    op.drop_table("app_settings")
