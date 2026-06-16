"""add_import_diagnostic_fields

Revision ID: 9f03d2e2a771
Revises: 7c2a9f4d8b11
Create Date: 2026-06-12 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision = "9f03d2e2a771"
down_revision = "7c2a9f4d8b11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activity_import_diagnostics",
        sa.Column("file_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "activity_import_diagnostics",
        sa.Column("inferred_title", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "activity_import_diagnostics",
        sa.Column("inferred_start_time", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "activity_import_diagnostics",
        sa.Column("computed_distance_m", sa.Float(), nullable=True),
    )
    op.add_column(
        "activity_import_diagnostics",
        sa.Column("computed_duration_s", sa.Float(), nullable=True),
    )
    op.add_column(
        "activity_import_diagnostics",
        sa.Column(
            "duplicate_reason", sqlmodel.sql.sqltypes.AutoString(), nullable=True
        ),
    )
    op.create_index(
        op.f("ix_activity_import_diagnostics_file_hash"),
        "activity_import_diagnostics",
        ["file_hash"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_activity_import_diagnostics_file_hash"),
        table_name="activity_import_diagnostics",
    )
    op.drop_column("activity_import_diagnostics", "duplicate_reason")
    op.drop_column("activity_import_diagnostics", "computed_duration_s")
    op.drop_column("activity_import_diagnostics", "computed_distance_m")
    op.drop_column("activity_import_diagnostics", "inferred_start_time")
    op.drop_column("activity_import_diagnostics", "inferred_title")
    op.drop_column("activity_import_diagnostics", "file_hash")
