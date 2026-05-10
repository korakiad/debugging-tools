'use strict';

// Fixture for runner.ipc.test.ts. The launcher fork()'s us under
// DEBUG_GUI_BAIL_ON_FAILURE=1 so beforeEach disables retries — the test
// pauses exactly once on failure, the test sends {type:'resume'} from the
// parent, afterEach returns, Mocha records the failure, afterAll fires,
// and the worker exits with code 1.
describe('ipc-fixture', function () {
    it('always fails', function () {
        throw new Error('intentional fail for IPC test');
    });
});
