import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthSession } from '../src/session.js';
import { ApiClient, ApiError, validatePassword } from '../src/api.js';
import { validateApiUrl } from '../src/config.js';

const user = { id: 'verified-account', email: 'student@example.test', displayName: 'Student', role: 'student' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function memoryStorage(initial = null) {
  let saved = initial;
  return { getToken: async () => saved, setToken: async token => { saved = token; }, clearToken: async () => { saved = null; }, saved: () => saved };
}
function verifiedApi() {
  const calls = [];
  return { calls, request: async (path, options) => {
    calls.push({ path, ...options });
    return path === '/auth/me' ? user : { token: 'test-only-token', user };
  } };
}

test('email auth verifies the issued token against /me before securely adopting identity', async () => {
  const storage = memoryStorage(), api = verifiedApi(), session = new AuthSession(storage, api);
  await session.authenticate('signup', { email: user.email, password: 'test-password', displayName: user.displayName, role: 'student' });
  assert.equal(session.state.user, user);
  assert.equal(storage.saved(), 'test-only-token');
  assert.deepEqual(api.calls.map(call => call.path), ['/auth/signup', '/auth/me']);
  assert.equal(api.calls[1].token, 'test-only-token');
  assert.equal(api.calls[1].body, undefined);
  await session.request('/sessions', { token: 'client-override-is-ignored' });
  assert.equal(api.calls.at(-1).token, 'test-only-token');
});
test('mismatched identity and unavailable secure storage fail closed', async () => {
  const storage = memoryStorage(), api = { request: async path => path === '/auth/me' ? { ...user, id: 'other' } : { token: 'test', user } };
  const session = new AuthSession(storage, api);
  await assert.rejects(session.authenticate('login', {}), /identity/);
  assert.equal(storage.saved(), null); assert.equal(session.token, null);
  const locked = new AuthSession({ ...storage, setToken: async () => { throw Error('locked'); } }, verifiedApi());
  await assert.rejects(locked.authenticate('login', {}), /saved securely/);
  assert.equal(locked.token, null);
});
test('restart restores encrypted token through backend verification; logout erases access', async () => {
  const storage = memoryStorage('test-only-token'), api = verifiedApi(), session = new AuthSession(storage, api);
  await session.restore(); assert.equal(session.state.phase, 'signedIn');
  assert.equal(api.calls[0].path, '/auth/me');
  await session.logout(); assert.equal(session.state.phase, 'signedOut'); assert.equal(storage.saved(), null);
  await assert.rejects(session.request('/sessions'), /sign in/);
});
test('expired tokens are cleared, while offline restoration keeps encrypted access for retry', async () => {
  const storage = memoryStorage('expired'), expired = new AuthSession(storage, { request: async () => { throw new ApiError('expired', 401); } });
  await expired.restore(); assert.equal(storage.saved(), null); assert.equal(expired.state.phase, 'signedOut');
  const offlineStorage = memoryStorage('still-stored'), offline = new AuthSession(offlineStorage, { request: async () => { throw new ApiError('offline'); } });
  await offline.restore(); assert.equal(offline.state.phase, 'error'); assert.equal(offline.token, null); assert.equal(offlineStorage.saved(), 'still-stored');
});
test('logout wins over a delayed login and a secure write already in flight', async () => {
  const login = deferred(), storage = memoryStorage(), session = new AuthSession(storage, { request: () => login.promise });
  const pending = session.authenticate('login', {}); await session.logout(); login.resolve({ token: 'late', user }); await pending;
  assert.equal(session.state.phase, 'signedOut'); assert.equal(storage.saved(), null);
  const write = deferred(), base = memoryStorage(), started = deferred();
  const slow = new AuthSession({ ...base, setToken: async token => { started.resolve(); await write.promise; await base.setToken(token); } }, verifiedApi());
  const signingIn = slow.authenticate('login', {}); await started.promise;
  const signingOut = slow.logout(); write.resolve(); await Promise.all([signingIn, signingOut]);
  assert.equal(slow.state.phase, 'signedOut'); assert.equal(base.saved(), null);
});
test('responses from a previous account cannot populate a new account screen', async () => {
  const response = deferred(), api = verifiedApi(), session = new AuthSession(memoryStorage(), api);
  await session.authenticate('login', {}); api.request = () => response.promise;
  const reading = session.request('/sessions'); await session.logout(); response.resolve({ sessions: ['private'] });
  await assert.rejects(reading, /Account changed/);
});
test('protected-route 401 clears local authentication', async () => {
  const api = verifiedApi(), storage = memoryStorage(), session = new AuthSession(storage, api);
  await session.authenticate('login', {}); api.request = async () => { throw new ApiError('expired', 401); };
  await assert.rejects(session.request('/sessions'), error => error.status === 401);
  assert.equal(storage.saved(), null); assert.equal(session.state.user, null);
});
test('bcrypt byte limits reject oversized UTF-8 without silent truncation', () => {
  validatePassword('a'.repeat(72)); validatePassword('🙂'.repeat(18));
  assert.throws(() => validatePassword('a'.repeat(73)), /72/);
  assert.throws(() => validatePassword('🙂'.repeat(19)), /72/);
  assert.throws(() => validatePassword('short'), /8/);
  assert.throws(() => validatePassword('abcdefgh\ud800'), /valid/);
});
test('API restricts origins and redirects, uses Bearer token, and never sends cookies', async () => {
  let received;
  const api = new ApiClient({ fetcher: async (...args) => { received = args; return { ok: true, status: 200, json: async () => ({ ok: true }) }; } });
  await api.request('/auth/me', { token: 'test-only-token' });
  assert.equal(received[1].headers.Authorization, 'Bearer test-only-token');
  assert.equal(received[1].credentials, 'omit'); assert.equal(received[1].redirect, 'error');
  await assert.rejects(api.request('//other.test/private', { token: 'secret' }), /Invalid/);
  for (const url of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/?secret=x', 'https://example.test/path']) assert.throws(() => validateApiUrl(url));
});
test('network, JSON, and authorization errors do not disclose request credentials', async () => {
  for (const fetcher of [async () => { throw Error('test-secret'); }, async () => ({ status: 502, json: async () => { throw Error('html'); } }), async () => ({ ok: false, status: 401, json: async () => ({ error: 'test-secret' }) })]) {
    const api = new ApiClient({ fetcher });
    await assert.rejects(api.request('/auth/login', { body: { password: 'test-secret' } }), error => !error.message.includes('test-secret'));
  }
});
