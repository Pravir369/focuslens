"""Preserve completion idempotency and original event order."""
from alembic import op
import sqlalchemy as sa

revision = 'e712fa800001'
down_revision = 'c308ab6c9782'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('sessions', sa.Column('end_reason', sa.String(20), nullable=True))
    op.add_column('sessions', sa.Column('completion_key', sa.String(64), nullable=True))
    op.add_column('events', sa.Column('position', sa.Integer(), server_default='0', nullable=False))


def downgrade():
    with op.batch_alter_table('events') as batch: batch.drop_column('position')
    with op.batch_alter_table('sessions') as batch:
        batch.drop_column('completion_key')
        batch.drop_column('end_reason')
