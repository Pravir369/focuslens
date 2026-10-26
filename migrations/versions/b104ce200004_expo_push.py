"""Account-owned native notification registrations; no study alert trigger yet."""
from alembic import op
import sqlalchemy as sa

revision = 'b104ce200004'
down_revision = 'a903bd100003'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('push_tokens',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('token', sa.String(256), nullable=False),
        sa.Column('platform', sa.String(10), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_push_tokens_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_push_tokens')),
        sa.UniqueConstraint('token', name=op.f('uq_push_tokens_token')),
        sa.CheckConstraint("platform IN ('ios', 'android')", name=op.f('ck_push_tokens_valid_platform')))
    op.create_index(op.f('ix_push_tokens_user_id'), 'push_tokens', ['user_id'])


def downgrade():
    op.drop_index(op.f('ix_push_tokens_user_id'), table_name='push_tokens')
    op.drop_table('push_tokens')
