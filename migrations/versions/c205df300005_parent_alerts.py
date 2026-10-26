"""Durable per-distraction parent notification claims."""
from alembic import op
import sqlalchemy as sa

revision = 'c205df300005'
down_revision = 'b104ce200004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('parent_alerts',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('session_id', sa.String(36), nullable=False),
        sa.Column('event_start_ms', sa.BigInteger(), nullable=False),
        sa.Column('distraction_duration_ms', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('accepted_count', sa.Integer(), nullable=False),
        sa.Column('failed_count', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'), sa.UniqueConstraint('session_id', 'event_start_ms'),
        sa.CheckConstraint('distraction_duration_ms >= 600000', name='minimum_duration'),
        sa.CheckConstraint('accepted_count >= 0 AND failed_count >= 0', name='delivery_counts'),
        sa.CheckConstraint("status IN ('sending', 'accepted', 'partial', 'failed', 'noRecipients')", name='valid_status'))
    op.create_index('ix_parent_alerts_session_id', 'parent_alerts', ['session_id'])


def downgrade():
    op.drop_index('ix_parent_alerts_session_id', table_name='parent_alerts')
    op.drop_table('parent_alerts')
