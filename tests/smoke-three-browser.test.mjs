import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { isVerifiedLoadedModelAbort, watchPage } from '../scripts/smoke-three-browser.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const modelRuntimeProof = {
  contextLost: false,
  destroyed: false,
  modelReady: true,
  programCount: 7,
  renderCount: 12,
  sourceGeometryCount: 1,
  sourceMaterialCount: 1,
  sourceTextureCount: 2
};

class FakePage extends EventEmitter {
  constructor(runtimeProof) {
    super();
    this.runtimeProof = runtimeProof;
  }

  async evaluate() { return this.runtimeProof; }
  isClosed() { return false; }
  async waitForLoadState() {}
  waitForTimeout() { return new Promise(() => {}); }
}

function modelExchange() {
  const url = 'http://127.0.0.1/game/assets/models/infected-swarmer.glb';
  const request = {
    failure: () => ({ errorText: 'net::ERR_ABORTED' }),
    url: () => url
  };
  const response = {
    request: () => request,
    status: () => 200,
    url: () => url
  };
  return { request, response };
}

test('only the exact completed model request abort is a verified DevTools artifact', () => {
  const request = {};
  const candidate = {
    errorText: 'net::ERR_ABORTED',
    pathname: '/game/assets/models/infected-swarmer.glb',
    request,
    responseRequest: request,
    responseStatus: 200,
    terminalRequest: request
  };

  assert.equal(isVerifiedLoadedModelAbort(candidate, modelRuntimeProof), true);
  assert.equal(isVerifiedLoadedModelAbort({
    ...candidate,
    pathname: '/game/assets/models/infected-stinger.glb'
  }, modelRuntimeProof), true);
  assert.equal(isVerifiedLoadedModelAbort({ ...candidate, terminalRequest: {} }, modelRuntimeProof), false);
  assert.equal(isVerifiedLoadedModelAbort({ ...candidate, responseStatus: 206 }, modelRuntimeProof), false);
  assert.equal(isVerifiedLoadedModelAbort({ ...candidate, errorText: 'net::ERR_FAILED' }, modelRuntimeProof), false);
  assert.equal(isVerifiedLoadedModelAbort({ ...candidate, pathname: '/game/assets/models/other.glb' }, modelRuntimeProof), false);
  assert.equal(isVerifiedLoadedModelAbort(candidate, { ...modelRuntimeProof, modelReady: false }), false);
  assert.equal(isVerifiedLoadedModelAbort(candidate, { ...modelRuntimeProof, renderCount: 0 }), false);
  assert.equal(isVerifiedLoadedModelAbort(candidate, { ...modelRuntimeProof, sourceTextureCount: 0 }), true);
  assert.equal(isVerifiedLoadedModelAbort(candidate, { ...modelRuntimeProof, sourceMaterialCount: 0 }), false);
});

test('each async error gate reconciles a model failure that arrives after idle', async () => {
  const verifiedFailures = {
    consoleErrors: [], modelResponses: [], pageErrors: [], requestFailures: [], verifiedModelAborts: []
  };
  const verifiedPage = new FakePage(modelRuntimeProof);
  const verifiedWatch = watchPage(verifiedPage, 'verified', verifiedFailures);
  const verifiedExchange = modelExchange();
  await verifiedWatch.waitForModelIdle();
  verifiedPage.emit('request', verifiedExchange.request);
  verifiedPage.emit('response', verifiedExchange.response);
  verifiedPage.emit('requestfailed', verifiedExchange.request);
  await verifiedWatch.assertNoErrors();
  assert.deepEqual(verifiedFailures.requestFailures, []);
  assert.deepEqual(verifiedFailures.verifiedModelAborts, [{
    errorText: 'net::ERR_ABORTED',
    label: 'verified',
    pathname: '/game/assets/models/infected-swarmer.glb',
    status: 200
  }]);

  const unverifiedFailures = {
    consoleErrors: [], modelResponses: [], pageErrors: [], requestFailures: [], verifiedModelAborts: []
  };
  const unverifiedPage = new FakePage(null);
  const unverifiedWatch = watchPage(unverifiedPage, 'unverified', unverifiedFailures);
  const unverifiedExchange = modelExchange();
  await unverifiedWatch.waitForModelIdle();
  unverifiedPage.emit('request', unverifiedExchange.request);
  unverifiedPage.emit('response', unverifiedExchange.response);
  unverifiedPage.emit('requestfailed', unverifiedExchange.request);
  await assert.rejects(unverifiedWatch.assertNoErrors(), /unverified browser failures/);
});

test('browser smoke fails on console and page errors raised during pagehide teardown', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      'scripts/smoke-three-browser.mjs',
      '--inject-teardown-errors'
    ], {
      cwd: projectRoot,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000
    }),
    (error) => {
      const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
      assert.equal(error?.code, 1);
      assert.match(output, /intentional teardown console error/);
      assert.match(output, /intentional teardown page error/);
      return true;
    }
  );
});
