import tempfile
import unittest
from pathlib import Path

import bcrypt
from flask_migrate import upgrade, downgrade
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from backend import create_app
from backend.models import db, User, UserSettings, FamilyLink, StudySession, Event


class ModelsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.app = create_app({"TESTING": True, "JWT_SECRET_KEY": "test-only-key-" * 4,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///" + str(Path(self.directory.name) / "test.sqlite3")})
        self.context = self.app.app_context(); self.context.push()
        upgrade()

    def tearDown(self):
        db.session.remove(); db.engine.dispose(); self.context.pop(); self.directory.cleanup()

    def user(self, email="student@example.test", role="student"):
        user = User(email=email, role=role, display_name="Test", password_hash=bcrypt.hashpw(b"Test pass 123", bcrypt.gensalt(4)))
        db.session.add(user); db.session.flush()
        return user

    def invalid(self, record):
        db.session.add(record)
        with self.assertRaises(IntegrityError): db.session.flush()
        db.session.rollback()

    def test_migrations_round_trip_and_match_models(self):
        self.assertEqual(set(inspect(db.engine).get_table_names()), {"alembic_version", "users", "user_settings", "family_links", "sessions", "events", "web_push_subscriptions"})
        from alembic.autogenerate import compare_metadata
        from alembic.migration import MigrationContext
        with db.engine.connect() as connection:
            self.assertEqual(compare_metadata(MigrationContext.configure(connection), db.metadata), [])
        downgrade(revision="base"); self.assertEqual(inspect(db.engine).get_table_names(), ["alembic_version"])
        upgrade(); self.user(); db.session.commit()

    def test_settings_migration_preserves_existing_accounts_and_cascades(self):
        downgrade(revision='e712fa800001')
        user=self.user();db.session.commit();owner=user.id
        upgrade()
        row=db.session.get(UserSettings,owner)
        self.assertTrue(row.onboarding_complete);self.assertIsNone(row.recipient_emails)
        self.assertEqual((row.goal_minutes,row.goal_engagement_pct,row.phone_policy),(25,80,'phone-free'))
        db.session.delete(user);db.session.commit();self.assertIsNone(db.session.get(UserSettings,owner))

    def test_user_constraints_and_public_whitelist(self):
        user = self.user(); db.session.commit()
        self.assertEqual(set(user.public()), {"id", "email", "displayName", "role"})
        self.invalid(User(email=user.email, role="parent", display_name="Other", google_id="google-test"))
        self.invalid(User(email="new@example.test", role="admin", display_name="Other", google_id="google-test"))
        self.invalid(User(email="new@example.test", role="student", display_name="Other"))

    def test_family_uniqueness_foreign_keys_and_cascade(self):
        student=self.user(); parent=self.user("parent@example.test", "parent"); db.session.commit()
        db.session.add(FamilyLink(parent_user_id=parent.id, student_user_id=student.id)); db.session.commit()
        self.invalid(FamilyLink(parent_user_id=parent.id, student_user_id=student.id))
        self.invalid(FamilyLink(parent_user_id=student.id, student_user_id=student.id))
        self.invalid(FamilyLink(parent_user_id="missing", student_user_id=student.id))
        db.session.delete(parent); db.session.commit()
        self.assertEqual(db.session.query(FamilyLink).count(), 0)

    def test_sessions_keep_ownership_metadata_and_events_keep_four_states(self):
        user=self.user(); db.session.commit()
        session=StudySession(user_id=user.id, start_time=1000, goal_minutes=25, goal_engagement_pct=80)
        db.session.add(session); db.session.commit()
        for kind in ("engaged", "distracted", "away", "drowsy"):
            db.session.add(Event(session_id=session.id, type=kind, trigger_source="window" if kind=="distracted" else None, start_time=1000, end_time=2000, duration_ms=1000))
        db.session.commit()
        self.invalid(Event(session_id=session.id, type="paused", start_time=1000, end_time=2000, duration_ms=1000))
        self.invalid(Event(session_id=session.id, type="engaged", trigger_source="cameraA", start_time=1000, end_time=2000, duration_ms=1000))
        self.invalid(Event(session_id=session.id, type="away", start_time=1000, end_time=2000, duration_ms=500))
        self.invalid(StudySession(user_id="missing", start_time=0, goal_minutes=25, goal_engagement_pct=80))
        db.session.delete(user); db.session.commit()
        self.assertEqual(db.session.query(Event).count(), 0)

    def test_legacy_summary_and_pacing_can_preserve_unknowns_without_invented_events(self):
        user=self.user(); db.session.commit()
        for source in ("legacy-summary", "legacy-pacing"):
            db.session.add(StudySession(user_id=user.id, end_time=10000, import_source=source, first_distraction_ms=5000))
        db.session.commit()
        self.assertEqual(db.session.query(Event).count(), 0)
        self.assertTrue(all(row.start_time is None for row in db.session.query(StudySession)))
        self.invalid(StudySession(user_id=user.id))  # Live rows require known settings.


if __name__ == "__main__": unittest.main()
