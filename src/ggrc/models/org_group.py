from ggrc import db
from .mixins import BusinessObject
from .object_document import Documentable
from .object_person import Personable

class OrgGroup(Documentable, Personable, BusinessObject, db.Model):
  __tablename__ = 'org_groups'
