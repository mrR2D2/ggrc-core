# Copyright (C) 2019 Google Inc.
# Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>

"""
Remove ACR records with invalid object_type values

Create Date: 2019-05-20 11:36:34.557392
"""
# disable Invalid constant name pylint warning for mandatory Alembic variables.
# pylint: disable=invalid-name


from alembic import op
import sqlalchemy as sa

from ggrc.models import all_models
from ggrc.migrations.utils import add_to_objects_without_revisions_bulk


# revision identifiers, used by Alembic.
revision = 'e75eb65a5a43'
down_revision = 'e1988524ed3e'


acr = all_models.AccessControlRole.__name__
models_names = [model.__name__ for model in all_models.all_models]
models_names.append('Clause')


def get_invalid_acrs():
  """
  Collect invalid records for access control roles
  Returns: filtered BaseQueryObject
  """
  invalid_acr = all_models.AccessControlRole.query.filter(
      all_models.AccessControlRole.object_type.notin_(models_names)
  )
  return invalid_acr


def delete_invalid_acr(connection, model_names):
  """
  Deleting invalid records from database
  Args:
    connection: current connection to DB
    model_names: list of correct models names

  Returns: None
  """

  connection.execute(sa.text(
      """
          DELETE FROM access_control_roles
          WHERE object_type NOT IN :model_names
      """),
      model_names=model_names
  )


def upgrade():
  """Upgrade database schema and/or data, creating a new revision."""

  conn = op.get_bind()
  invalid_acr = get_invalid_acrs()

  if invalid_acr.count() > 0:
    invalid_acr_ids = [x.id for x in invalid_acr]
    add_to_objects_without_revisions_bulk(conn,
                                          invalid_acr_ids,
                                          acr,
                                          "deleted")
    delete_invalid_acr(conn, models_names)


def downgrade():
  """Downgrade database schema and/or data back to the previous revision."""
  raise NotImplementedError("Downgrade is not supported")
