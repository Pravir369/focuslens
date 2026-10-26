"""Saved settings always belong to the verified account."""
from flask import Blueprint, g, jsonify
from sqlalchemy.exc import IntegrityError

from .auth import json_fields, normalized_email
from .models import db, FamilyLink, User, UserSettings
from .session_data import number
from .tokens import require_auth

preferences = Blueprint('preferences', __name__)
FIELDS = {'goalMinutes', 'goalEngagementPct', 'phonePolicy', 'recipientEmails'}


def report_defaults(user):
    settings = db.session.get(UserSettings, user.id)
    if settings and settings.recipient_emails is not None:
        return list(settings.recipient_emails)
    parents = []
    if user.role == 'student':
        parents = list(db.session.execute(db.select(User.email).join(FamilyLink, FamilyLink.parent_user_id == User.id)
            .where(FamilyLink.student_user_id == user.id).order_by(FamilyLink.created_at, FamilyLink.id).limit(1)).scalars())
    return [user.email] + parents


def public_settings(user):
    row = db.session.get(UserSettings, user.id)
    return dict(goalMinutes=row.goal_minutes if row else 25,
                goalEngagementPct=row.goal_engagement_pct if row else 80,
                phonePolicy=row.phone_policy if row else 'phone-free',
                recipientEmails=report_defaults(user), onboardingComplete=bool(row and row.onboarding_complete))


@preferences.get('/preferences')
@require_auth
def get_preferences():
    return jsonify(public_settings(g.user))


@preferences.put('/preferences')
@require_auth
def save_preferences():
    try:
        data = json_fields(FIELDS)
        if set(data) != FIELDS: raise ValueError('Complete your study settings and report recipients.')
        minutes = number(data['goalMinutes'], 1, 1440, integer=True)
        target = number(data['goalEngagementPct'], 0, 100, integer=True)
        if data['phonePolicy'] not in ('phone-free', 'phone-allowed'): raise ValueError('Choose a phone policy.')
        addresses = data['recipientEmails']
        if not isinstance(addresses, list) or not 1 <= len(addresses) <= 3:
            raise ValueError('Add one to three report email addresses.')
        addresses = list(dict.fromkeys(normalized_email(address) for address in addresses))
        row = db.session.get(UserSettings, g.user_id)
        if row is None:
            row = UserSettings(user_id=g.user_id)
            db.session.add(row)
        row.goal_minutes = minutes; row.goal_engagement_pct = target; row.phone_policy = data['phonePolicy']
        row.recipient_emails = addresses; row.onboarding_complete = True
        db.session.commit()
        return jsonify(public_settings(g.user))
    except ValueError as error:
        db.session.rollback()
        return jsonify(error=str(error)), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify(error='Settings changed in another tab. Reload and try again.'), 409
