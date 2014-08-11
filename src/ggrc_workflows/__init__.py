# Copyright (C) 2013 Google Inc., authors, and contributors <see AUTHORS file>
# Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>
# Created By: dan@reciprocitylabs.com
# Maintained By: dan@reciprocitylabs.com

from datetime import datetime, date, timedelta
import calendar
from flask import Blueprint
from sqlalchemy import inspect

from ggrc import settings, db
from ggrc.login import get_current_user
#from ggrc.rbac import permissions
from ggrc.services.registry import service
from ggrc.views.registry import object_view
from ggrc_basic_permissions.models import Role, UserRole, ContextImplication
import ggrc_workflows.models as models


# Initialize signal handler for status changes
from blinker import Namespace
signals = Namespace()
status_change = signals.signal(
  'Status Changed',
  """
  This is used to signal any listeners of any changes in model object status
  attribute
  """)

workflow_cycle_start = signals.signal(
  'Workflow Cycle Started ',
  """
  This is used to signal any listeners of any workflow cycle start
  attribute
  """)

# Initialize Flask Blueprint for extension
blueprint = Blueprint(
  'ggrc_workflows',
  __name__,
  template_folder='templates',
  static_folder='static',
  static_url_path='/static/ggrc_workflows',
)


from ggrc.models import all_models

_workflow_object_types = [
    "Program",
    "Regulation", "Standard", "Policy", "Contract",
    "Objective", "Control", "Section", "Clause",
    "System", "Process",
    "DataAsset", "Facility", "Market", "Product", "Project"
    ]

for type_ in _workflow_object_types:
  model = getattr(all_models, type_)
  model.__bases__ = (
    #models.workflow_object.Workflowable,
    models.task_group_object.TaskGroupable,
    models.cycle_task_group_object.CycleTaskGroupable,
    models.workflow.WorkflowState,
    ) + model.__bases__
  #model.late_init_workflowable()
  model.late_init_task_groupable()
  model.late_init_cycle_task_groupable()


def get_public_config(current_user):
  """Expose additional permissions-dependent config to client.
  """
  return {}
#  public_config = {}
#  if permissions.is_admin():
#    if hasattr(settings, 'RISK_ASSESSMENT_URL'):
#      public_config['RISK_ASSESSMENT_URL'] = settings.RISK_ASSESSMENT_URL
#  return public_config


# Initialize service endpoints

def contributed_services():
  return [
      service('workflows', models.Workflow),
      service('workflow_people', models.WorkflowPerson),
      service('task_groups', models.TaskGroup),
      service('task_group_tasks', models.TaskGroupTask),
      service('task_group_objects', models.TaskGroupObject),

      service('cycles', models.Cycle),
      service('cycle_task_entries', models.CycleTaskEntry),
      service('cycle_task_groups', models.CycleTaskGroup),
      service('cycle_task_group_objects', models.CycleTaskGroupObject),
      service('cycle_task_group_object_tasks', models.CycleTaskGroupObjectTask)
      ]


def contributed_object_views():
  from . import models

  return [
      object_view(models.Workflow),
      ]

def update_cycle_date_range(cycle):
  start_date = None
  end_date = None

  for ctg in cycle.cycle_task_groups:
    for ctgo in ctg.cycle_task_group_objects:
      for task in ctgo.cycle_task_group_object_tasks:
        task_start_date = task.start_date
        if isinstance(task_start_date, datetime):
          task_start_date = task_start_date.date()
        task_end_date = task.end_date
        if isinstance(task_end_date, datetime):
          task_end_date = task_end_date.date()
        if start_date is None or start_date > task_start_date:
          start_date = task_start_date
        if end_date is None or end_date < task_end_date:
          end_date = task_end_date

  cycle.start_date = start_date
  cycle.end_date = end_date


from ggrc.services.common import Resource

@Resource.model_posted.connect_via(models.Cycle)
def handle_cycle_post(sender, obj=None, src=None, service=None):
  current_user = get_current_user()

  if not src.get('autogenerate'):
    return

  # Determine the relevant Workflow
  workflow = obj.workflow

  # Populate the top-level Cycle object
  obj.context = workflow.context
  obj.title = workflow.title
  obj.description = workflow.description
  obj.status = 'InProgress'

  # Find the starting date of the period containing the start date or today
  if obj.start_date:
    base_date = obj.start_date
  elif workflow.next_cycle_start_date:
    base_date = workflow.next_cycle_start_date
  else:
    base_date = date.today()

  workflow_cycle_start.send(
      obj.__class__,
      obj=obj,
      new_status=obj.status,
      old_status=None
      )

  # Populate CycleTaskGroups based on Workflow's TaskGroups
  for task_group in workflow.task_groups:
    cycle_task_group = models.CycleTaskGroup(
        context=obj.context,
        cycle=obj,
        task_group=task_group,
        title=task_group.title,
        description=task_group.description,
        end_date=obj.end_date,
        modified_by=current_user,
        contact=task_group.contact,
        sort_index=task_group.sort_index,
        )

    for task_group_object in task_group.task_group_objects:
      object = task_group_object.object

      cycle_task_group_object = models.CycleTaskGroupObject(
          context=obj.context,
          cycle=obj,
          cycle_task_group=cycle_task_group,
          task_group_object=task_group_object,
          title=object.title,
          modified_by=current_user,
          end_date=obj.end_date,
          object=object,
          )
      cycle_task_group.cycle_task_group_objects.append(
          cycle_task_group_object)

      for task_group_task in task_group.task_group_tasks:
        cycle_task_group_object_task = models.CycleTaskGroupObjectTask(
          context=obj.context,
          cycle=obj,
          #cycle_task_group_object=cycle_task_group_object,
          task_group_task=task_group_task,
          title=task_group_task.title,
          description=task_group_task.description,
          sort_index=task_group_task.sort_index,
          start_date=task_group_task.calc_start_date(base_date),
          end_date=task_group_task.calc_end_date(base_date),
          contact=task_group.contact,
          status="Assigned",
          modified_by=current_user,
          )
        cycle_task_group_object.cycle_task_group_object_tasks.append(
            cycle_task_group_object_task)

      #update_cycle_task_group_object_date_rang(cycle_task_group_object)
    #update_cycle_task_group_date_range(cycle_task_group)
  update_cycle_date_range(obj)


# 'InProgress' states propagate via these links
_cycle_object_parent_attr = {
    models.CycleTaskGroupObjectTask: 'cycle_task_group_object',
    models.CycleTaskGroupObject: 'cycle_task_group',
    models.CycleTaskGroup: 'cycle'
    }

# 'Finished' and 'Verified' states are determined via these links
_cycle_object_children_attr = {
    models.CycleTaskGroupObject: 'cycle_task_group_object_tasks',
    models.CycleTaskGroup: 'cycle_task_group_objects',
    models.Cycle: 'cycle_task_groups'
    }


def update_cycle_object_parent_state(obj):
  parent_attr = _cycle_object_parent_attr.get(type(obj), None)
  if not parent_attr:
    return

  parent = getattr(obj, parent_attr, None)
  if not parent:
    return

  # If any child is `InProgress`, then parent should be `InProgress`
  if obj.status == 'InProgress' or obj.status == 'Declined':
    if parent.status != 'InProgress':
      old_status = parent.status
      parent.status = 'InProgress'
      db.session.add(parent)
      status_change.send(
          parent.__class__,
          obj=parent,
          new_status=parent.status,
          old_status=old_status
          )
      update_cycle_object_parent_state(parent)
  # If all children are `Finished` or `Verified`, then parent should be same
  elif obj.status == 'Finished' or obj.status == 'Verified':
    children_attr = _cycle_object_children_attr.get(type(parent), None)
    if children_attr:
      children = getattr(parent, children_attr, None)
      children_finished = True
      children_verified = True
      for child in children:
        if child.status != 'Verified':
          children_verified = False
          if child.status != 'Finished':
            children_finished = False
      if children_verified:
        old_status=parent.status
        parent.status = 'Verified'
        status_change.send(
            parent.__class__,
            obj=parent,
            new_status=parent.status,
            old_status=old_status
            )
        update_cycle_object_parent_state(parent)
      elif children_finished:
        old_status=parent.status
        parent.status = 'Finished'
        status_change.send(
            parent.__class__,
            obj=parent,
            new_status=parent.status,
            old_status=old_status
            )
        update_cycle_object_parent_state(parent)


@Resource.model_put.connect_via(models.CycleTaskGroupObjectTask)
def handle_cycle_task_group_object_task_put(
    sender, obj=None, src=None, service=None):
  if inspect(obj).attrs.start_date.history.has_changes() \
      or inspect(obj).attrs.end_date.history.has_changes():
    update_cycle_date_range(obj.cycle)

  if inspect(obj).attrs.status.history.has_changes():
    update_cycle_object_parent_state(obj)

    if obj.cycle.workflow.object_approval \
        and obj.cycle.status == 'Verified':
      for tgobj in obj.task_group_task.task_group.objects:
        old_status = tgobj.status
        tgobj.status = 'Final'
        status_change.send(
            tgobj.__class__,
            obj=tgobj,
            new_status=tgobj.status,
            old_status=old_status
            )

# FIXME: Duplicates `ggrc_basic_permissions._get_or_create_personal_context`
def _get_or_create_personal_context(user):
  personal_context = user.get_or_create_object_context(
      context=1,
      name='Personal Context for {0}'.format(user.id),
      description='',
      )
  personal_context.modified_by = get_current_user()
  db.session.add(personal_context)
  db.session.flush()
  return personal_context


def _find_role(role_name):
  return db.session.query(Role).filter(Role.name == role_name).first()


@Resource.model_posted.connect_via(models.WorkflowPerson)
def handle_workflow_person_post(sender, obj=None, src=None, service=None):
  db.session.flush()

  # add a user_roles mapping assigning the user creating the workflow
  # the WorkflowOwner role in the workflow's context.
  workflow_member_role = _find_role('WorkflowMember')
  user_role = UserRole(
      person=obj.person,
      role=workflow_member_role,
      context=obj.context,
      modified_by=get_current_user(),
      )
  db.session.add(user_role)


@Resource.model_posted.connect_via(models.Workflow)
def handle_workflow_post(sender, obj=None, src=None, service=None):

  if src.get('clone'):
    source_workflow_id = src.get('clone')
    source_workflow = models.Workflow.query.filter_by(
        id=source_workflow_id
        ).first()
    source_workflow.copy(obj)
    db.session.add(obj)
    db.session.flush()
    obj.title = source_workflow.title + ' (copy ' + str(obj.id) + ')'

  db.session.flush()
  # get the personal context for this logged in user
  user = get_current_user()
  personal_context = _get_or_create_personal_context(user)
  context = obj.build_object_context(
      context=personal_context,
      name='{object_type} Context {timestamp}'.format(
        object_type=service.model.__name__,
        timestamp=datetime.now()),
      description='',
      )
  context.modified_by = get_current_user()

  db.session.add(obj)
  db.session.flush()
  db.session.add(context)
  db.session.flush()
  obj.contexts.append(context)
  obj.context = context

  # add a user_roles mapping assigning the user creating the workflow
  # the WorkflowOwner role in the workflow's context.
  workflow_owner_role = _find_role('WorkflowOwner')
  user_role = UserRole(
      person=get_current_user(),
      role=workflow_owner_role,
      context=context,
      modified_by=get_current_user(),
      )
  # pass along a temporary attribute for logging the events.
  user_role._display_related_title = obj.title
  db.session.add(user_role)
  db.session.flush()

  # Create the context implication for Workflow roles to default context
  db.session.add(ContextImplication(
      source_context=context,
      context=None,
      source_context_scope='Workflow',
      context_scope=None,
      modified_by=get_current_user(),
      ))

  if not src.get('private'):
    # Add role implication - all users can read a public workflow
    add_public_workflow_context_implication(context)


def add_public_workflow_context_implication(context, check_exists=False):
  if check_exists and db.session.query(ContextImplication)\
      .filter(
          and_(
            ContextImplication.context_id == context.id,
            ContextImplication.source_context_id == None))\
      .count() > 0:
    return
  db.session.add(ContextImplication(
    source_context=None,
    context=context,
    source_context_scope=None,
    context_scope='Workflow',
    modified_by=get_current_user(),
    ))


from ggrc_basic_permissions.contributed_roles import (
    RoleContributions, RoleDeclarations, DeclarativeRoleImplications
    )
from ggrc_workflows.roles import (
    WorkflowOwner, WorkflowMember, BasicWorkflowReader, WorkflowBasicReader
    )


class WorkflowRoleContributions(RoleContributions):
  contributions = {
      'ProgramCreator': {
        'create': ['Workflow', 'Task'],
        'read': ['Task'],
        'update': ['Task'],
        'delete': ['Task'],
        },
      'ObjectEditor': {
        'create': ['Workflow', 'Task'],
        'read': ['Task'],
        'update': ['Task'],
        'delete': ['Task'],
        },
      'Reader': {
        'read': ['Task']
        },
      'ProgramEditor': {
        'create': ['Workflow', 'Task']
        },
      'ProgramOwner': {
        'create': ['Workflow', 'Task']
        },
      }


class WorkflowRoleDeclarations(RoleDeclarations):
  def roles(self):
    return {
        'WorkflowOwner': WorkflowOwner,
        'WorkflowMember': WorkflowMember,
        'BasicWorkflowReader': BasicWorkflowReader,
        'WorkflowBasicReader': WorkflowBasicReader,
        }


class WorkflowRoleImplications(DeclarativeRoleImplications):
  # (Source Context Type, Context Type)
  #   -> Source Role -> Implied Role for Context
  implications = {
      (None, 'Workflow'): {
        'ProgramCreator': ['BasicWorkflowReader'],
        'ObjectEditor': ['BasicWorkflowReader'],
        'Reader': ['BasicWorkflowReader'],
        },
      ('Workflow', None): {
        'WorkflowOwner': ['WorkflowBasicReader'],
        'WorkflowMember': ['WorkflowBasicReader'],
        },
      }


ROLE_CONTRIBUTIONS = WorkflowRoleContributions()
ROLE_DECLARATIONS = WorkflowRoleDeclarations()
ROLE_IMPLICATIONS = WorkflowRoleImplications()

from ggrc_workflows.notification import notify_email_digest, notify_email_deferred
