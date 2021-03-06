/*
  Copyright (C) 2019 Google Inc.
  Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>
*/

import canComponent from 'can-component';
import {generateCycle} from '../../plugins/utils/workflow-utils';
import {getPageInstance} from '../../plugins/utils/current-page-utils';
import {initCounts} from '../../plugins/utils/widgets-utils';
import {countsMap as workflowCountsMap} from '../../apps/workflows';

export default canComponent.extend({
  tag: 'workflow-start-cycle',
  content: '<content></content>',
  events: {
    click: async function () {
      const workflow = getPageInstance();
      await generateCycle(workflow);
      await initCounts(
        [workflowCountsMap.activeCycles],
        workflow.type, workflow.id);
      return workflow.refresh_all('task_groups', 'task_group_tasks');
    },
  },
  leakScope: true,
});
