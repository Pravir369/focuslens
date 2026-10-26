"""Persist onboarding and account study/report preferences."""
from alembic import op
import sqlalchemy as sa

revision = 'f813bc900002'
down_revision = 'e712fa800001'
branch_labels = None
depends_on = None


def upgrade():
    table = op.create_table('user_settings',
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('goal_minutes', sa.Integer(), server_default='25', nullable=False),
        sa.Column('goal_engagement_pct', sa.Integer(), server_default='80', nullable=False),
        sa.Column('phone_policy', sa.String(20), server_default='phone-free', nullable=False),
        sa.Column('recipient_emails', sa.JSON(), nullable=True),
        sa.Column('onboarding_complete', sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.CheckConstraint('goal_minutes BETWEEN 1 AND 1440', name=op.f('ck_user_settings_duration_range')),
        sa.CheckConstraint('goal_engagement_pct BETWEEN 0 AND 100', name=op.f('ck_user_settings_target_range')),
        sa.CheckConstraint("phone_policy IN ('phone-free', 'phone-allowed')", name=op.f('ck_user_settings_phone_policy')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE', name=op.f('fk_user_settings_user_id_users')),
        sa.PrimaryKeyConstraint('user_id', name=op.f('pk_user_settings')))
    # Existing users keep access and their previous self/parent report defaults.
    # New password and Google accounts have no row until onboarding is saved.
    users = sa.table('users', sa.column('id', sa.String(36)))
    op.execute(table.insert().from_select(['user_id', 'onboarding_complete'], sa.select(users.c.id, sa.true())))


def downgrade():
    op.drop_table('user_settings')
