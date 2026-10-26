import test from 'node:test';
import assert from 'node:assert/strict';
import { PushRegistration } from '../src/push-registration.js';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function setup(saved = null) {
  const calls = [], writes = [];
  const session = { state: { phase: 'signedIn', user: { id: 'verified-owner' } }, request: async (path, options) => {
    calls.push({path, ...options}); return path === '/push-tokens' ? {registrationId:'registration'} : {jobId:'test-job', status:'accepted', error:''};
  } };
  const storage = { get: async () => saved, set: async value => { writes.push(value); saved = value; }, clear: async () => { saved = null; }, saved: () => saved };
  const device = { register: async () => ({ token:'ExpoPushToken[synthetic-test-token]', platform:'ios' }) };
  const controller = new PushRegistration(session, device, storage);
  return { controller, session, storage, device, calls, writes };
}
test('registration only follows explicit connect, caches credentials securely, sends no claimed identity', async () => {
  const {controller, calls, writes} = setup(); await controller.restore(); assert.equal(calls.length,0);
  await controller.connect(); assert.equal(controller.state.connected,true);
  assert.equal(writes.length,2); assert.equal(writes[0].registrationId,null);
  assert.deepEqual(calls[0].body,{token:'ExpoPushToken[synthetic-test-token]',platform:'ios'});
  await controller.test(); assert.deepEqual(calls[1].body,{registrationId:'registration'});
  await controller.check(); assert.equal(calls[2].path,'/push-tokens/jobs/test-job');
});
test('restoration separates owners and cleanup removes registration before clearing secure cache', async () => {
  const previous = {userId:'other-owner', token:'other-token', registrationId:'other-registration'};
  const {controller,calls,storage} = setup(previous); await controller.restore();
  assert.equal(controller.state.connected,false); assert.equal(controller.record,null);
  await controller.connect(); assert.equal(await controller.disconnect(),true);
  assert.equal(calls.at(-1).method,'DELETE'); assert.equal(storage.saved(),null); assert.equal(controller.state.connected,false);
});
test('failed cleanup keeps retry information and reports an honest offline sign-out warning', async () => {
  const {controller,session,storage} = setup(); await controller.restore(); await controller.connect();
  session.request = async () => {throw Error('network-secret-must-not-appear');};
  assert.equal(await controller.disconnect(),false); assert.ok(storage.saved());
  assert.match(controller.state.error,/may remain/); assert.doesNotMatch(controller.state.error,/network-secret/);
});
test('permission cancellation, unmount and account switches never register to a different owner', async () => {
  for (const action of ['dispose','switch']) {
    const {controller,session,device,calls} = setup(), token = deferred(); await controller.restore();
    device.register = () => token.promise;
    const connecting = controller.connect();
    if (action === 'dispose') controller.dispose(); else session.state.user.id = 'new-owner';
    token.resolve({token:'synthetic-token',platform:'ios'}); await connecting;
    assert.equal(calls.length,0);
  }
});
test('double taps do not duplicate registration and unsupported runtime errors are safe', async () => {
  const {controller,device,calls} = setup(), ready = deferred(); await controller.restore(); device.register=()=>ready.promise;
  const first=controller.connect(); await controller.connect(); ready.resolve({token:'synthetic-token',platform:'ios'}); await first;
  assert.equal(calls.length,1);
  device.register=async()=>{throw Object.assign(Error('secret'),{safeMessage:'Use a real phone.'});};
  await controller.connect(); assert.equal(controller.state.error,'Use a real phone.');
});
