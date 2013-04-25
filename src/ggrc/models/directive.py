from ggrc import db
from sqlalchemy.ext.associationproxy import association_proxy
from .mixins import Slugged, Hyperlinked

class Directive(Slugged, Hyperlinked, db.Model):
  __tablename__ = 'directives'

  company = db.Column(db.Boolean, default=False, nullable=False)
  version = db.Column(db.String)
  #FIXME Can this be Timeboxed for these two fields?
  start_date = db.Column(db.DateTime)
  stop_date = db.Column(db.DateTime)
  organization = db.Column(db.String)
  scope = db.Column(db.Text)
  kind_id = db.Column(db.Integer)
  audit_start_date = db.Column(db.DateTime)
  audit_frequency_id = db.Column(db.Integer)
  audit_duration_id = db.Column(db.Integer)
  kind = db.Column(db.String)
  sections = db.relationship(
      'Section', backref='parent', order_by='Section.slug')
  controls = db.relationship(
      'Control', backref='directive', order_by='Control.slug')
  program_directives = db.relationship('ProgramDirective', backref='directive')
  programs = association_proxy('program_directives', 'program')
  audit_frequency = db.relationship(
      'Option',
      primaryjoin='and_(foreign(Directive.audit_frequency_id) == Option.id, '\
                       'Option.role == "audit_frequency")',
      uselist=False,
      )
  audit_duration = db.relationship(
      'Option',
      primaryjoin='and_(foreign(Directive.audit_duration_id) == Option.id, '\
                       'Option.role == "audit_duration")',
      uselist=False,
      )
