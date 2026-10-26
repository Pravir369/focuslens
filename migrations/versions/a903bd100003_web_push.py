"""Account-owned Web Push subscriptions for the free Home Screen companion."""
from alembic import op
import sqlalchemy as sa

revision = 'a903bd100003'
down_revision = 'f813bc900002'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('web_push_subscriptions',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('endpoint_hash', sa.String(64), nullable=False),
        sa.Column('endpoint', sa.String(4096), nullable=False),
        sa.Column('p256dh', sa.String(128), nullable=False),
        sa.Column('auth', sa.String(32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_web_push_subscriptions_user_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_web_push_subscriptions')),
        sa.UniqueConstraint('endpoint_hash', name=op.f('uq_web_push_subscriptions_endpoint_hash')))
    op.create_index(op.f('ix_web_push_subscriptions_user_id'), 'web_push_subscriptions', ['user_id'])


def downgrade():
    op.drop_index(op.f('ix_web_push_subscriptions_user_id'), table_name='web_push_subscriptions')
    op.drop_table('web_push_subscriptions')
