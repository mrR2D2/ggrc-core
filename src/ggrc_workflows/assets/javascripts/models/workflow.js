/*!
    Copyright (C) 2017 Google Inc.
    Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>
*/


(function(can) {

  can.Model.Cacheable("CMS.Models.Workflow", {
    root_object: "workflow",
    root_collection: "workflows",
    category: "workflow",
    mixins: ['ca_update', 'timeboxed', 'accessControlList'],
    findAll: "GET /api/workflows",
    findOne: "GET /api/workflows/{id}",
    create: "POST /api/workflows",
    update: "PUT /api/workflows/{id}",
    destroy: "DELETE /api/workflows/{id}",
    is_custom_attributable: true,

    attributes: {
      task_groups: "CMS.Models.TaskGroup.stubs",
      cycles: "CMS.Models.Cycle.stubs",
      //workflow_task_groups: "CMS.Models.WorkflowTaskGroup.stubs"
      modified_by: "CMS.Models.Person.stub",
      context: "CMS.Models.Context.stub",
      custom_attribute_values: "CMS.Models.CustomAttributeValue.stubs",
      repeat_every: 'number',
      default_lhn_filters: {
        Workflow: {status: 'Active'},
        Workflow_All: {},
        Workflow_Active: {status: 'Active'},
        Workflow_Inactive: {status: 'Inactive'},
        Workflow_Draft: {status: 'Draft'}
      }
    },
    defaults: {
      task_group_title: 'Task Group 1',
    },
    obj_nav_options: {
      show_all_tabs: true,
    },
    tree_view_options: {
      attr_view: GGRC.mustache_path + '/workflows/tree-item-attr.mustache',
      attr_list : [
        {attr_title: 'Title', attr_name: 'title'},
        {attr_title: 'Code', attr_name: 'slug'},
        {attr_title: 'State', attr_name: 'status'},
        {attr_title: 'Last Updated', attr_name: 'updated_at'},
        {attr_title: 'Last Updated By', attr_name: 'modified_by'}
      ],
      display_attr_names: ['title', 'status', 'updated_at', 'Admin',
        'Workflow Member'],
    },

    init: function() {
      this._super && this._super.apply(this, arguments);
      this.validateNonBlank("title");

      this.bind("destroyed", function(ev, inst) {
        if(inst instanceof CMS.Models.Workflow) {
          can.each(inst.cycles, function(cycle) {
            if (!cycle) {
              return;
            }
            cycle = cycle.reify()
            can.trigger(cycle, "destroyed");
            can.trigger(cycle.constructor, "destroyed", cycle);
          });
          can.each(inst.task_groups, function(tg) {
            if (!tg) {
              return;
            }
            tg = tg.reify();
            can.trigger(tg, "destroyed");
            can.trigger(tg.constructor, "destroyed", tg);
          });
        }
      });
    }
  }, {
    save: function () {
      var taskGroupTitle = this.task_group_title;
      var isNew = this.isNew();
      var redirectLink;
      var taskGroup;
      var dfd;

      dfd = this._super.apply(this, arguments);
      dfd.then(function (instance) {
        redirectLink = instance.viewLink + '#task_group_widget';
        instance.attr('_redirect', redirectLink);
        if (!taskGroupTitle || !isNew) {
          return instance;
        }
        taskGroup = new CMS.Models.TaskGroup({
          title: taskGroupTitle,
          workflow: instance,
          contact: instance.people && instance.people[0] || instance.modified_by,
          context: instance.context
        });
        return taskGroup.save()
          .then(function (tg) {
            // Prevent the redirect form workflow_page.js
            taskGroup.attr('_no_redirect', true);
            instance.attr('_redirect', redirectLink + '/task_group/' + tg.id);
            return this;
          }.bind(this));
      }.bind(this));
      return dfd;
    },
  });
})(window.can);
