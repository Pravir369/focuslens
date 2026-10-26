"""Client-confirmed escalation with durable, one-use send claims.

The browser owns real-time detection. These checks establish account/session
ownership and plausible timing, not independent proof of camera observations.
Never resume or automatically retry a send after a timeout or process restart.
"""
from datetime import datetime, timedelta, timezone
import threading

from flask import Blueprint, abort, current_app, g, jsonify
from sqlalchemy.exc import IntegrityError

from .auth import json_fields
from .expo_push import ProviderError
from .models import db, ExpoPushToken, FamilyLink, ParentAlert, StudySession, User
from .session_data import identifier, number
from .tokens import require_auth

api = Blueprint('parent_alerts', __name__)
ALERT_MS = 600000


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def public_alert(row):
    interrupted = row.status == 'sending' and datetime.now(timezone.utc) - utc(row.created_at) > timedelta(minutes=10)
    return dict(alertId=row.id, status='interrupted' if interrupted else row.status,
                acceptedCount=row.accepted_count, failedCount=row.failed_count)


class ParentAlerts:
    def __init__(self, app):
        self.app = app
        # Bounded request admission and SQLite development serialization. The
        # database lock + unique claim is authoritative on managed PostgreSQL.
        self.lock = threading.RLock()

    def queue(self, alert_id):
        threading.Thread(target=self.work, args=(alert_id,), daemon=True, name='focuslens-parent-alert').start()

    def work(self, alert_id):
        with self.app.app_context():
            try:
                row = db.session.get(ParentAlert, alert_id)
                if row is None or row.status != 'sending': return
                session = db.session.get(StudySession, row.session_id)
                if session is None: return
                owner = session.user_id
                registrations = list(db.session.execute(db.select(ExpoPushToken.id).join(
                    FamilyLink, FamilyLink.parent_user_id == ExpoPushToken.user_id).join(
                    User, User.id == ExpoPushToken.user_id).where(
                    FamilyLink.student_user_id == owner, User.role == 'parent')).scalars())
                # Release the DB connection while contacting the provider.
                db.session.remove()
                accepted = failed = 0
                for registration_id in registrations:
                    registration = db.session.execute(db.select(ExpoPushToken).join(
                        FamilyLink, FamilyLink.parent_user_id == ExpoPushToken.user_id).where(
                        ExpoPushToken.id == registration_id, FamilyLink.student_user_id == owner)).scalar_one_or_none()
                    if registration is None:
                        db.session.remove(); continue  # Disconnected/unlinked before sending.
                    token, parent_id = registration.token, registration.user_id
                    db.session.remove()
                    try:
                        sender = self.app.config.get('EXPO_ALERT_SENDER') or self.app.extensions['expo_push'].deliver_alert
                        sender(token, alert_id)
                        accepted += 1
                    except Exception as error:
                        failed += 1
                        if isinstance(error, ProviderError) and error.code == 'DeviceNotRegistered':
                            old = db.session.get(ExpoPushToken, registration_id)
                            if old and old.user_id == parent_id and old.token == token:
                                db.session.delete(old); db.session.commit()
                            db.session.remove()
                    # Persist progress after each attempt. Ambiguous provider
                    # failures are never resent; accepted is only an Expo ticket.
                    row = db.session.get(ParentAlert, alert_id)
                    if row is None: return
                    row.accepted_count = accepted; row.failed_count = failed
                    db.session.commit(); db.session.remove()
                row = db.session.get(ParentAlert, alert_id)
                if row:
                    row.status = ('partial' if failed else 'accepted') if accepted else ('failed' if failed else 'noRecipients')
                    db.session.commit()
            except Exception:
                db.session.rollback()
                # A send may already have succeeded. Preserve its durable claim
                # and never log provider exceptions, tokens, or SQL parameters.
                try:
                    row = db.session.get(ParentAlert, alert_id)
                    if row: row.status = 'failed'; db.session.commit()
                except Exception: db.session.rollback()
            finally: db.session.remove()


@api.errorhandler(ValueError)
def invalid(error):
    db.session.rollback(); return jsonify(error=str(error)), 400


@api.post('/notify-parent')
@require_auth
def notify_parent():
    if g.user.role != 'student': return jsonify(error='Only a student study session can request a check-in.'), 403
    data = json_fields({'sessionId', 'distractionDurationMs', 'eventStartMs'})
    session_id = identifier(data.get('sessionId'))
    duration = number(data.get('distractionDurationMs'), ALERT_MS, 86400000, integer=True)
    start = number(data.get('eventStartMs'), integer=True)
    state = current_app.extensions['parent_alerts']
    with state.lock:
        db.session.execute(db.select(User).where(User.id == g.user_id).with_for_update()).scalar_one()
        session = db.session.execute(db.select(StudySession).where(
            StudySession.id == session_id, StudySession.user_id == g.user_id).with_for_update()).scalar_one_or_none()
        if session is None: abort(404)
        existing = db.session.execute(db.select(ParentAlert).where(
            ParentAlert.session_id == session.id, ParentAlert.event_start_ms == start)).scalar_one_or_none()
        if existing: return jsonify(public_alert(existing)), 200
        if session.import_source != 'live' or session.end_time is not None:
            return jsonify(error='Only an active study session can request a check-in.'), 409
        now = datetime.now(timezone.utc); now_ms = int(now.timestamp() * 1000)
        if start < session.start_time or start > now_ms or duration > now_ms - start + 5000:
            raise ValueError('Check-in timing does not match this session. Check your device clock.')
        # Durable account-level rate cap also prevents new session IDs/event
        # timestamps from bypassing per-event deduplication.
        recent = db.session.scalar(db.select(db.func.count()).select_from(ParentAlert).join(StudySession).where(
            StudySession.user_id == g.user_id, ParentAlert.created_at > now - timedelta(minutes=10)))
        if recent: return jsonify(error='A check-in was already requested recently.'), 429
        global_recent = db.session.scalar(db.select(db.func.count()).select_from(ParentAlert).where(
            ParentAlert.created_at > now - timedelta(hours=1)))
        if global_recent >= 100: return jsonify(error='Check-ins are busy. Study tracking continues normally.'), 429
        row = ParentAlert(session_id=session.id, event_start_ms=start, distraction_duration_ms=duration)
        db.session.add(row)
        try: db.session.commit()
        except IntegrityError:
            db.session.rollback()
            existing = db.session.execute(db.select(ParentAlert).where(
                ParentAlert.session_id == session_id, ParentAlert.event_start_ms == start)).scalar_one_or_none()
            if existing: return jsonify(public_alert(existing)), 200
            return jsonify(error='Check-in registration changed. Study tracking continues normally.'), 409
        result = public_alert(row); state.queue(row.id)
        return jsonify(result), 202


@api.get('/parent-alerts/<alert_id>')
@require_auth
def alert_status(alert_id):
    identifier(alert_id)
    row = db.session.execute(db.select(ParentAlert).join(StudySession).where(
        ParentAlert.id == alert_id, StudySession.user_id == g.user_id)).scalar_one_or_none()
    if row is None: abort(404)
    return jsonify(public_alert(row))
