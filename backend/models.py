"""Account ownership is a database foreign key, never a claimed profile ID."""
from datetime import datetime, timezone
import uuid

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import CheckConstraint, MetaData, UniqueConstraint, event
from sqlalchemy.engine import Engine
import sqlite3

db = SQLAlchemy(metadata=MetaData(naming_convention={
    "ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s", "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}))


@event.listens_for(Engine, "connect")
def sqlite_foreign_keys(connection, _):
    if isinstance(connection, sqlite3.Connection):
        cursor = connection.cursor(); cursor.execute("PRAGMA foreign_keys=ON"); cursor.close()


def identifier():
    return str(uuid.uuid4())


def utc_now():
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.String(36), primary_key=True, default=identifier)
    email = db.Column(db.String(254), nullable=False, unique=True)
    password_hash = db.Column(db.LargeBinary(60), nullable=True)
    google_id = db.Column(db.String(255), unique=True, nullable=True)
    display_name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    __table_args__ = (CheckConstraint("role IN ('student', 'parent')", name="valid_role"),
                     CheckConstraint("password_hash IS NOT NULL OR google_id IS NOT NULL", name="login_method"))

    def public(self):
        # Explicit whitelist: never serialize the model or its password hash.
        return {"id": self.id, "email": self.email, "displayName": self.display_name, "role": self.role}


class FamilyLink(db.Model):
    __tablename__ = "family_links"
    id = db.Column(db.String(36), primary_key=True, default=identifier)
    parent_user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    student_user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    __table_args__ = (UniqueConstraint("parent_user_id", "student_user_id"),
                     CheckConstraint("parent_user_id != student_user_id", name="different_users"))


class StudySession(db.Model):
    __tablename__ = "sessions"
    id = db.Column(db.String(36), primary_key=True, default=identifier)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    start_time = db.Column(db.BigInteger, nullable=True)
    end_time = db.Column(db.BigInteger, nullable=True)
    goal_minutes = db.Column(db.Float, nullable=True)
    goal_engagement_pct = db.Column(db.Float, nullable=True)
    avg_recovery_speed_ms = db.Column(db.Float, nullable=True)
    engagement_pct = db.Column(db.Float, nullable=True)
    distraction_count = db.Column(db.Integer, nullable=True)
    longest_distraction_ms = db.Column(db.Float, nullable=True)
    recovery_count = db.Column(db.Integer, nullable=True)
    active_ms = db.Column(db.Float, nullable=True)
    first_distraction_ms = db.Column(db.Float, nullable=True)
    phone_policy = db.Column(db.String(20), nullable=True)
    # Needed to preserve the earlier pause/unknown exclusions when server-side
    # metrics are added. They are session metadata, not additional event states.
    active_segments = db.Column(db.JSON, nullable=True)
    unclassified_periods = db.Column(db.JSON, nullable=True)
    import_source = db.Column(db.String(20), nullable=False, default="live")
    legacy_key = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    __table_args__ = (
        UniqueConstraint("user_id", "legacy_key"),
        CheckConstraint("import_source IN ('live', 'legacy-summary', 'legacy-pacing')", name="valid_import_source"),
        CheckConstraint("import_source != 'live' OR (start_time IS NOT NULL AND goal_minutes IS NOT NULL AND goal_engagement_pct IS NOT NULL)", name="live_settings_required"),
        CheckConstraint("end_time IS NULL OR start_time IS NULL OR end_time >= start_time", name="time_order"),
        CheckConstraint("goal_minutes IS NULL OR goal_minutes > 0", name="positive_goal"),
        CheckConstraint("goal_engagement_pct IS NULL OR goal_engagement_pct BETWEEN 0 AND 100", name="goal_range"),
        CheckConstraint("engagement_pct IS NULL OR engagement_pct BETWEEN 0 AND 100", name="engagement_range"),
        CheckConstraint("phone_policy IS NULL OR phone_policy IN ('phone-free', 'phone-allowed')", name="valid_phone_policy"),
        CheckConstraint("distraction_count IS NULL OR distraction_count >= 0", name="distraction_count"),
        CheckConstraint("recovery_count IS NULL OR recovery_count >= 0", name="recovery_count"),
        CheckConstraint("avg_recovery_speed_ms IS NULL OR avg_recovery_speed_ms >= 0", name="recovery_duration"),
        CheckConstraint("longest_distraction_ms IS NULL OR longest_distraction_ms >= 0", name="longest_duration"),
        CheckConstraint("active_ms IS NULL OR active_ms >= 0", name="active_duration"),
        CheckConstraint("first_distraction_ms IS NULL OR first_distraction_ms >= 0", name="first_duration"),
    )


class Event(db.Model):
    __tablename__ = "events"
    id = db.Column(db.String(36), primary_key=True, default=identifier)
    session_id = db.Column(db.String(36), db.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    type = db.Column(db.String(12), nullable=False)
    trigger_source = db.Column(db.String(10), nullable=True)
    start_time = db.Column(db.BigInteger, nullable=False)
    end_time = db.Column(db.BigInteger, nullable=False)
    duration_ms = db.Column(db.BigInteger, nullable=False)
    __table_args__ = (
        CheckConstraint("type IN ('engaged', 'distracted', 'drowsy', 'away')", name="valid_type"),
        CheckConstraint("trigger_source IS NULL OR (type = 'distracted' AND trigger_source IN ('cameraA', 'cameraB', 'window'))", name="valid_source"),
        CheckConstraint("end_time >= start_time AND duration_ms = end_time - start_time", name="duration_matches"),
    )
