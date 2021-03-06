# Copyright (C) 2019 Google Inc.
# Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>

"""Module for integration tests for Relationship."""

from ggrc.models import all_models
from integration.external_app.external_api_helper import ExternalApiClient

from integration.ggrc import TestCase
from integration.ggrc.models import factories


class TestExternalRelationshipNew(TestCase):
  """Integration test suite for External Relationship."""

  # pylint: disable=invalid-name

  def setUp(self):
    """Init API helper"""
    super(TestExternalRelationshipNew, self).setUp()
    self.ext_api = ExternalApiClient()

  def test_ext_app_delete_normal_relationship(self):
    """External app can't delete normal relationships"""

    with factories.single_commit():
      issue = factories.IssueFactory()
      objective = factories.ObjectiveFactory()

      relationship = factories.RelationshipFactory(
          source=issue, destination=objective, is_external=False
      )
      relationship_id = relationship.id
    ext_api = ExternalApiClient(use_ggrcq_service_account=True)
    resp = ext_api.delete("relationship", relationship_id)
    self.assertStatus(resp, 400)

  def test_sync_service_delete_normal_relationship(self):
    """Sync service can delete normal relationships via unmap endpoint"""

    with factories.single_commit():
      issue = factories.IssueFactory()
      objective = factories.ObjectiveFactory()

      relationship = factories.RelationshipFactory(
          source=issue, destination=objective, is_external=False
      )
      relationship_id = relationship.id
    resp = self.ext_api.unmap(issue, objective)
    self.assert200(resp)
    rel = all_models.Relationship.query.get(relationship_id)
    self.assertIsNone(rel)
