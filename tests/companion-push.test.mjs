import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function worker() {
  const handlers = {}, notices = [], messages = [], opened = [], focused = [];
  const self = { location: { origin: 'https://focuslens.example' }, addEventListener: (type, action) => { handlers[type] = action; },
    registration: { showNotification: async (...args) => notices.push(args) },
    clients: { matchAll: async () => [{ url: 'https://focuslens.example/companion/', postMessage: value => messages.push(value), focus: async () => focused.push(true) }], openWindow: async url => opened.push(url) } };
  vm.runInNewContext(await readFile(new URL('../companion/sw.js', import.meta.url), 'utf8'), { self, URL });
  async function dispatch(type, event) { let work; handlers[type]({ ...event, waitUntil: promise => { work = promise; } }); await work; }
  return { dispatch, notices, messages, opened, focused, handlers, self };
}
test('push worker uses a fixed visible message without displaying payload-supplied private data', async () => {
  const w = await worker();
  await w.dispatch('push', { data: { json: () => ({ kind: 'test', testId: 'a'.repeat(36), title: 'Private student name', body: 'Private session details', url: 'https://evil.test' }) } });
  assert.equal(w.notices[0][0], 'FocusLens test'); assert.ok(!JSON.stringify(w.notices).includes('Private'));
  assert.equal(w.messages[0].testId, 'a'.repeat(36));
  assert.equal(w.handlers.fetch, undefined);
});
test('malformed push still displays a generic notification and cannot inject a click destination', async () => {
  const w = await worker(); await w.dispatch('push', { data: { json: () => { throw Error('bad JSON'); } } });
  assert.equal(w.notices[0][0], 'FocusLens update');
  let closed = false;
  w.self.clients.matchAll = async () => [];
  await w.dispatch('notificationclick', { notification: { data: { url: 'https://evil.test' }, close: () => { closed = true; } } });
  assert.equal(closed, true); assert.deepEqual(w.opened, ['https://focuslens.example/companion/']);
});
test('notification click focuses an existing companion instead of opening another window', async () => {
  const w = await worker(); await w.dispatch('notificationclick', { notification: { close: () => {} } });
  assert.equal(w.focused.length, 1); assert.equal(w.opened.length, 0);
});
