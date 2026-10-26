import { ApiClient } from './api.js';
const publicUser = value => value && typeof value.id === 'string' && typeof value.email === 'string' && typeof value.displayName === 'string' && ['student', 'parent'].includes(value.role);

export class AuthSession {
  constructor(storage, api = new ApiClient()) {
    this.storage = storage; this.api = api; this.token = null; this.generation = 0;
    this.listeners = new Set(); this.storageWork = Promise.resolve();
    this.state = { phase: 'loading', user: null, error: '' };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  update(state) { this.state = state; for (const listener of this.listeners) listener(state); }
  store(work) { const result = this.storageWork.then(work); this.storageWork = result.catch(() => {}); return result; }
  async restore() {
    const generation = ++this.generation; this.update({ phase: 'loading', user: null, error: '' });
    try {
      const token = await this.store(() => this.storage.getToken());
      if (generation !== this.generation) return;
      if (!token) { this.token = null; this.update({ phase: 'signedOut', user: null, error: '' }); return; }
      const user = await this.api.request('/auth/me', { token });
      if (generation !== this.generation) return;
      if (!publicUser(user)) throw new Error('Your account response could not be verified.');
      this.token = token; this.update({ phase: 'signedIn', user, error: '' });
    } catch (error) {
      if (generation !== this.generation) return;
      this.token = null;
      if (error.status === 401) {
        try { await this.store(() => this.storage.clearToken()); }
        catch { if (generation === this.generation) this.update({ phase: 'error', user: null, error: 'Could not clear expired secure access. Please retry.' }); return; }
        if (generation === this.generation) this.update({ phase: 'signedOut', user: null, error: 'Your sign-in expired. Please sign in again.' });
      } else this.update({ phase: 'error', user: null, error: error.message || 'Could not read your secure sign-in. Retry or sign out.' });
    }
  }
  async authenticate(kind, fields) {
    if (!['login', 'signup'].includes(kind)) throw new Error('Choose email sign-in or account creation.');
    const generation = ++this.generation;
    let result;
    try { result = await this.api.request(`/auth/${kind}`, { method: 'POST', body: fields }); }
    catch (error) { if (error.status === 401) throw new Error('Invalid email or password.'); throw error; }
    return this.completeAuthentication(result, generation);
  }
  async authenticateExternal(exchange) {
    const generation = ++this.generation;
    const result = await exchange();
    return this.completeAuthentication(result, generation);
  }
  async completeAuthentication(result, generation) {
    if (generation !== this.generation) return;
    if (typeof result.token !== 'string' || !publicUser(result.user)) throw new Error('Your sign-in response could not be verified.');
    const user = await this.api.request('/auth/me', { token: result.token });
    if (generation !== this.generation) return;
    if (!publicUser(user) || user.id !== result.user.id) throw new Error('Your account identity could not be verified.');
    try { await this.store(async () => { if (generation === this.generation) await this.storage.setToken(result.token); }); }
    catch { throw new Error('Your sign-in could not be saved securely on this device. Please retry.'); }
    if (generation !== this.generation) return;
    this.token = result.token; this.update({ phase: 'signedIn', user, error: '' });
  }
  async logout() {
    const generation = ++this.generation; this.token = null;
    this.update({ phase: 'loading', user: null, error: '' });
    try {
      await this.store(() => this.storage.clearToken());
      if (generation === this.generation) this.update({ phase: 'signedOut', user: null, error: '' });
    } catch { if (generation === this.generation) this.update({ phase: 'error', user: null, error: 'Secure sign-out did not finish. Please try signing out again.' }); }
  }
  async request(path, options = {}) {
    const token = this.token, generation = this.generation;
    if (!token || this.state.phase !== 'signedIn') throw new Error('Please sign in first.');
    try {
      const data = await this.api.request(path, { ...options, token });
      if (generation !== this.generation) throw new Error('Account changed. Reload this screen.');
      return data;
    } catch (error) {
      if (error.status === 401 && generation === this.generation) await this.logout();
      throw error;
    }
  }
}
