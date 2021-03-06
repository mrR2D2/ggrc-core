/*
  Copyright (C) 2019 Google Inc.
  Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>
*/

import canMap from 'can-map';
import ModalsController from '../modals/modals_controller';
import * as NotifiersUtils from '../../plugins/utils/notifiers-utils';
import Person from '../../models/business-models/person';
import * as ReifyUtils from '../../plugins/utils/reify-utils';
import * as currentPageUtils from '../../plugins/utils/current-page-utils';

describe('ModalsController', function () {
  let Ctrl; // the controller under test
  let cacheBackup;

  beforeAll(function () {
    Ctrl = ModalsController;
    cacheBackup = Person.cache;
    Person.cache = {};
  });

  afterAll(function () {
    Person.cache = cacheBackup;
  });

  describe('init() method', function () {
    let ctrlInst; // fake controller instance
    let init; // the method under tests

    beforeEach(function () {
      let html = [
        '<div>',
        '  <div class="modal-body"></div>',
        '</div>',
      ].join('');

      let $el = $(html);

      ctrlInst = {
        options: new canMap({}),
        element: $el,
        after_preload: jasmine.createSpy(),
      };

      init = Ctrl.prototype.init.bind(ctrlInst);
    });

    it('waits until current user is pre-fetched if not yet in cache',
      function (done) {
        let userId = GGRC.current_user.id;
        let dfdFetch = new $.Deferred();
        let fetchedUser = new canMap({id: userId, email: 'john@doe.com'});

        spyOn(Person, 'findOne').and.returnValue(dfdFetch.promise());
        delete Person.cache[userId];

        init();

        expect(ctrlInst.after_preload).not.toHaveBeenCalled();
        dfdFetch.resolve(fetchedUser).then(() => {
          expect(ctrlInst.after_preload).toHaveBeenCalled();
          done();
        });
      }
    );

    it('waits until current user is pre-fetched if only partially in cache',
      function (done) {
        let userId = GGRC.current_user.id;
        let dfdRefresh = new $.Deferred();
        let fetchedUser = new canMap({id: userId, email: 'john@doe.com'});

        let partialUser = new canMap({
          id: userId,
          email: '', // simulate user object only partially loaded
          refresh: jasmine.createSpy().and.returnValue(dfdRefresh.promise()),
        });

        spyOn(ReifyUtils, 'reify').and.returnValue(partialUser);
        Person.cache[userId] = partialUser;

        init();

        expect(ctrlInst.after_preload).not.toHaveBeenCalled();
        dfdRefresh.resolve(fetchedUser).then(() => {
          expect(ctrlInst.after_preload).toHaveBeenCalled();
          done();
        });
      }
    );

    it('does not wait for fetching the current user if already in cache',
      function () {
        jasmine.clock().install();

        let dfdRefresh = new $.Deferred();
        let userId = GGRC.current_user.id;

        let fullUser = new canMap({
          id: userId,
          email: 'john@doe.com',
          refresh: jasmine.createSpy().and.returnValue(dfdRefresh.promise()),
        });

        spyOn(ReifyUtils, 'reify').and.returnValue(fullUser);
        Person.cache[userId] = fullUser;

        init();

        jasmine.clock().tick(1);
        // after_preload should have been called immediately
        expect(ctrlInst.after_preload).toHaveBeenCalled();

        jasmine.clock().uninstall();
      }
    );
  });

  describe('save_error method', function () {
    let method;
    let foo;
    let ctrlInst;

    beforeEach(function () {
      ctrlInst = jasmine.createSpyObj(['disableEnableContentUI']);
      foo = jasmine.createSpy();
      spyOn(NotifiersUtils, 'notifier');
      spyOn(NotifiersUtils, 'notifierXHR')
        .and.returnValue(foo);
      spyOn(window, 'clearTimeout');
      method = Ctrl.prototype.save_error.bind(ctrlInst);
    });
    it('calls notifierXHR with response' +
    ' if error status is not 409', function () {
      const response = {status: 400, responseText: 'mockText'};
      method({}, response);
      expect(NotifiersUtils.notifierXHR)
        .toHaveBeenCalledWith('error', response);
    });
    it('clears timeout of error warning if error status is 409', function () {
      method({}, {status: 409, warningId: 999});
      expect(clearTimeout).toHaveBeenCalledWith(999);
    });
    it('calls notifierXHR with response' +
    ' if error status is 409', function () {
      let error = {status: 409};
      method({}, error);
      expect(NotifiersUtils.notifierXHR)
        .toHaveBeenCalledWith('warning', error);
    });

    it('calls "disableEnableContentUI" method', () => {
      method();
      expect(ctrlInst.disableEnableContentUI).toHaveBeenCalledWith(false);
    });
  });

  describe('reset_form() method', () => {
    let ctrlInst;
    let method;
    let instance;
    let setFieldsCb;

    beforeEach(function () {
      instance = new canMap();
      ctrlInst = {
        wasDestroyed: jasmine.createSpy('wasDestroyed'),
        element: {
          trigger: jasmine.createSpy('trigger'),
        },
        options: {
          new_object_form: 'mock1',
          object_params: 'mock2',
        },
      };
      method = Ctrl.prototype.reset_form.bind(ctrlInst);
    });

    describe('if modal was not destroyed', () => {
      beforeEach(() => {
        ctrlInst.wasDestroyed.and.returnValue(false);
      });

      it('calls setFieldsCb() if it is function', (done) => {
        setFieldsCb = function () {
          done();
        };

        method(instance, setFieldsCb);
      });

      it('triggers loaded event', () => {
        method(instance);

        expect(ctrlInst.element.trigger).toHaveBeenCalledWith('loaded');
      });

      it('calls formPreload of instance if it is defined', () => {
        let pageInstance = {};
        spyOn(currentPageUtils, 'getPageInstance')
          .and.returnValue(pageInstance);
        instance.formPreload = jasmine.createSpy();

        method(instance);

        expect(instance.formPreload).toHaveBeenCalledWith(
          ctrlInst.options.new_object_form,
          ctrlInst.options.object_params,
          pageInstance
        );
      });

      describe('if formPreload returns deferred', () => {
        let formPreloadDfd;

        beforeEach(() => {
          formPreloadDfd = $.Deferred();
          instance.backup = jasmine.createSpy('backup');
          instance.formPreload = jasmine.createSpy('formPreload').and
            .returnValue(formPreloadDfd);
        });

        it('calls instance.backup() when resolved', (done) => {
          let methodChain = method(instance);

          formPreloadDfd.resolve().then(() => {
            methodChain.then(() => {
              expect(instance.backup).toHaveBeenCalled();
              done();
            });
          });
        });

        it('returns formPreloadDfd', () => {
          expect(method(instance)).toBe(formPreloadDfd);
        });
      });

      it('returns resolved deferred if formPreload is not defined', (done) => {
        method(instance).done(() => {
          done();
        });
      });
    });

    it('sets new canMap object into _transient ' +
    'if it is not defined', () => {
      instance.attr('_transient', undefined);

      method(instance);

      expect(instance.attr('_transient') instanceof canMap).toBe(true);
      expect(instance.attr('_transient').serialize()).toEqual({});
    });

    it('does not change _transient if it is  defined', () => {
      let transient = 123;
      instance.attr('_transient', transient);

      method(instance);

      expect(instance.attr('_transient')).toBe(transient);
    });
  });

  describe('new_instance method', () => {
    let ctrlInst;
    let method;
    let newInstance;
    let resetFormDfd;

    beforeEach(function () {
      newInstance = new canMap();
      resetFormDfd = $.Deferred();
      ctrlInst = {
        prepareInstance: jasmine.createSpy('prepareInstance').and
          .returnValue(newInstance),
        reset_form: jasmine.createSpy('reset_form').and
          .returnValue(resetFormDfd),
        apply_object_params: jasmine.createSpy('apply_object_params'),
        serialize_form: jasmine.createSpy('serialize_form'),
        restore_ui_status: jasmine.createSpy('restore_ui_status'),
        options: new canMap(),
      };
      method = Ctrl.prototype.new_instance.bind(ctrlInst);
    });

    it('calls reset_form() with new prepared instance', (done) => {
      resetFormDfd.resolve();

      method();

      expect(ctrlInst.reset_form).toHaveBeenCalledWith(
        newInstance, jasmine.any(Function));
      done();
    });

    it('assigns new prepared instance into controller options ' +
    'after reset_form()', (done) => {
      method();

      resetFormDfd.done(() => {
        expect(ctrlInst.options.attr('instance')).toBe(newInstance);
        done();
      });

      resetFormDfd.resolve();
    });

    it('calls apply_object_params()', (done) => {
      jasmine.clock().install();

      resetFormDfd.resolve();
      method();

      jasmine.clock().tick(1);
      expect(ctrlInst.apply_object_params).toHaveBeenCalled();
      done();

      jasmine.clock().uninstall();
    });

    it('calls serialize_form()', (done) => {
      jasmine.clock().install();

      resetFormDfd.resolve();
      method();

      jasmine.clock().tick(1);
      expect(ctrlInst.serialize_form).toHaveBeenCalled();
      done();

      jasmine.clock().uninstall();
    });
  });
});
