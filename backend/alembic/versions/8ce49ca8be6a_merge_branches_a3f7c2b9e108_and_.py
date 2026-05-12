"""merge branches a3f7c2b9e108 and a7c1d3b9e201

Revision ID: 8ce49ca8be6a
Revises: a3f7c2b9e108, a7c1d3b9e201
Create Date: 2026-05-12 12:56:05.276523

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8ce49ca8be6a'
down_revision: Union[str, None] = ('a3f7c2b9e108', 'a7c1d3b9e201')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
