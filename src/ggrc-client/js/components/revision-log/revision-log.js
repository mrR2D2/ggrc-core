/*
 Copyright (C) 2019 Google Inc.
 Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>
 */

import '../tree_pagination/tree_pagination';
import '../paginate/paginate';
import './revision-page';
import RefreshQueue from '../../models/refresh_queue';
import template from './revision-log.stache';
import tracker from '../../tracker';
import Revision from '../../models/service-models/revision';
import Stub from '../../models/stub';
import {reify as reifyUtil, isReifiable} from '../../plugins/utils/reify-utils';

import {
  buildParam,
  batchRequests,
} from '../../plugins/utils/query-api-utils';
import QueryParser from '../../generated/ggrc_filter_query_parser';
import Pagination from '../base-objects/pagination';

export default can.Component.extend({
  tag: 'revision-log',
  template,
  leakScope: true,
  viewModel: {
    define: {
      showFilter: {
        get() {
          return (this.attr('review.status') === 'Unreviewed') &&
            !!this.attr('review.last_reviewed_by');
        },
      },
      pageInfo: {
        value: function () {
          return new Pagination({
            pageSizeSelect: [10, 25, 50],
            pageSize: 10,
          });
        },
      },
    },
    options: {},
    instance: null,
    review: null,
    isLoading: false,
    revisions: null,
    // for last revision where properties of objects was changed,
    // we need fetch additional revision for calculating diff
    getRevisionForCompare(lastRevision) {
      const instance = this.attr('instance');
      const createdAt = moment(lastRevision.created_at)
        .format('YYYY-MM-DD HH:mm:ss');
      const filter = QueryParser.parse(
        `resource_type = ${instance.type} AND
         resource_id = ${instance.id} AND
         created_at < "${createdAt}"`);
      const page = {
        current: 1,
        pageSize: 1,
        sort: [{
          direction: 'desc',
          key: 'created_at',
        }],
      };
      let params = buildParam(
        'Revision',
        page,
        null,
        null,
        filter
      );

      return batchRequests(params).then((data) => {
        return this.makeRevisionModels(data.Revision);
      }).then((revisions) => {
        let rq = new RefreshQueue();
        this._fetchAdditionalInfoForRevisions(rq, revisions);

        return rq.trigger().then(() => revisions);
      });
    },
    getAllRevisions() {
      const instance = this.attr('instance');
      const filter = QueryParser.parse(
        `${instance.type} not_empty_revisions_for ${instance.id} OR
         source_type = ${instance.type} AND
         source_id = ${instance.id} OR
         destination_type = ${instance.type} AND
         destination_id = ${instance.id}`);
      let pageInfo = this.attr('pageInfo');
      const page = {
        current: pageInfo.current,
        pageSize: pageInfo.pageSize,
        sort: [{
          direction: 'desc',
          key: 'created_at',
        }],
      };
      let params = buildParam(
        'Revision',
        page,
        null,
        null,
        filter
      );

      return batchRequests(params).then((data) => {
        data = data.Revision;
        const total = data.total;
        this.attr('pageInfo.total', total);

        return this.makeRevisionModels(data);
      });
    },
    getAfterReviewRevisions() {
      const instance = this.attr('instance');
      const reviewDate = moment(this.attr('review.last_reviewed_at'))
        .format('YYYY-MM-DD HH:mm:ss');
      const filter = QueryParser.parse(
        `resource_type = ${instance.type} AND
         resource_id = ${instance.id} AND
         created_at >= ${reviewDate} OR
         source_type = ${instance.type} AND
         source_id = ${instance.id} AND
         created_at >= ${reviewDate} OR
         destination_type = ${instance.type} AND
         destination_id = ${instance.id} AND
         created_at >= ${reviewDate}`);
      let pageInfo = this.attr('pageInfo');
      const page = {
        current: pageInfo.current,
        pageSize: pageInfo.pageSize,
        sort: [{
          direction: 'desc',
          key: 'created_at',
        }],
      };
      let params = buildParam(
        'Revision',
        page,
        null,
        null,
        filter
      );

      return batchRequests(params).then((data) => {
        data = data.Revision;
        const total = data.total;
        this.attr('pageInfo.total', total);

        return this.makeRevisionModels(data);
      });
    },
    makeRevisionModels(data) {
      let revisions = data.values;
      revisions = revisions.map(function (source) {
        return Revision.model(source, 'Revision');
      });

      return revisions;
    },

    fetchItems: function () {
      this.attr('isLoading', true);
      this.attr('revisions', null);

      const stopFn = tracker.start(
        this.attr('instance.type'),
        tracker.USER_JOURNEY_KEYS.LOADING,
        tracker.USER_ACTIONS.CHANGE_LOG);

      return this._fetchRevisionsData()
        .done((revisionsData) => {
          this.attr('revisions', revisionsData);
          stopFn();
        })
        .fail(function () {
          stopFn(true);
          $('body').trigger(
            'ajax:flash',
            {error: 'Failed to fetch revision history data.'});
        })
        .always(function () {
          this.attr('isLoading', false);
        }.bind(this));
    },
    _fetchAdditionalInfoForRevisions(refreshQueue, revisions) {
      _.forEach(revisions, (revision) => {
        if (revision.modified_by) {
          refreshQueue.enqueue(revision.modified_by);
        }
        if (revision.destination_type && revision.destination_id) {
          revision.destination = new Stub({
            id: revision.destination_id,
            type: revision.destination_type,
          });
          refreshQueue.enqueue(revision.destination);
        }
        if (revision.source_type && revision.source_id) {
          revision.source = new Stub({
            id: revision.source_id,
            type: revision.source_type,
          });
          refreshQueue.enqueue(revision.source);
        }
      });
    },
    _reifyRevision(revision) {
      _.forEach(['modified_by', 'source', 'destination'],
        function (field) {
          if (revision[field] && isReifiable(revision[field])) {
            revision.attr(field, reifyUtil(revision[field]));
          }
        });
      return revision;
    },
    _fetchRevisionsData() {
      let fetchRevisions = this.attr('options.showLastReviewUpdates') ?
        this.getAfterReviewRevisions.bind(this) :
        this.getAllRevisions.bind(this);

      return fetchRevisions().then(
        (revisions) => {
          let rq = new RefreshQueue();
          this._fetchAdditionalInfoForRevisions(rq, revisions);

          let dfdForCompare = $.Deferred().resolve([]);
          // find last revision with modified content by excluding revisions with mappings
          const lastModifiedRevision = _.findLast(revisions,
            (revision) => !revision.source && !revision.destination);

          if (lastModifiedRevision) {
            dfdForCompare = this.getRevisionForCompare(lastModifiedRevision);
          }

          return $.when(dfdForCompare, rq.trigger())
            .then((revisionsForCompare) => {
              return this.composeRevisionsData(revisions, revisionsForCompare);
            });
        });
    },
    composeRevisionsData(revisions, revisionsForCompare = []) {
      let objRevisions = [];
      let mappings = [];
      _.forEach(revisions, (revision) => {
        if (revision.destination || revision.source) {
          mappings.push(revision);
        } else {
          objRevisions.push(revision);
        }
      });

      return {
        object: _.map(objRevisions, this._reifyRevision),
        mappings: _.map(mappings, this._reifyRevision),
        revisionsForCompare: _.map(revisionsForCompare, this._reifyRevision),
      };
    },
    changeLastUpdatesFilter(element) {
      const isChecked = element.checked;
      this.attr('options.showLastReviewUpdates', isChecked);

      this.attr('pageInfo.current', 1);
      this.fetchItems();
    },
    getLastUpdatesFlag() {
      return this.attr('showFilter') &&
        this.attr('options.showLastReviewUpdates');
    },
    initObjectReview() {
      const review = this.attr('instance.review');

      if (review) {
        this.attr('review', reifyUtil(review));
      }
    },
  },
  /**
   * The component's entry point. Invoked when a new component instance has
   * been created.
   */
  init: function () {
    const viewModel = this.viewModel;

    viewModel.initObjectReview();

    viewModel.fetchItems();
  },
  events: {
    '{viewModel.instance} refreshInstance': function () {
      this.viewModel.fetchItems();
    },
    '{viewModel.pageInfo} current'() {
      this.viewModel.fetchItems();
    },
    '{viewModel.pageInfo} pageSize'() {
      this.viewModel.fetchItems();
    },
    removed() {
      this.viewModel.attr('options.showLastReviewUpdates', false);
    },
  },
});
