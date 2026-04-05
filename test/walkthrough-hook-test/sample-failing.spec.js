// Minimal test fixture to verify the walkthrough hook pauses on failure.

describe('Walkthrough Hook Verification', function () {
    it('should pass', function () {
        // This test passes — hook should NOT pause here
    });

    it('should fail and trigger pause', function () {
        throw new Error('Deliberate failure to test walkthrough hook');
    });

    it('should also pass', function () {
        // This test should only run AFTER agent signals continue
    });
});
