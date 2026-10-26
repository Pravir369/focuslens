// This module has no OS dependencies so ownership/race handling can be tested.
export class PushRegistration {
  constructor(session, device, storage) {
    this.session = session; this.device = device; this.storage = storage;
    this.owner = session.state.user.id; this.record = null; this.active = true;
    this.listeners = new Set(); this.state = { busy: true, connected: false, error: '', message: '', job: null };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  update(values) { if (this.active) { this.state = { ...this.state, ...values }; for (const listener of this.listeners) listener(this.state); } }
  current() { return this.active && this.session.state.phase === 'signedIn' && this.session.state.user.id === this.owner; }
  dispose() { this.active = false; this.listeners.clear(); }
  async restore() {
    try {
      const record = await this.storage.get();
      if (!this.current()) return;
      // The cached owner only separates local device settings. The server
      // independently verifies JWT ownership for every operation.
      this.record = record?.userId === this.owner ? record : null;
      this.update({ connected: Boolean(this.record?.registrationId) });
    } catch { this.update({ error: 'Could not read secure notification settings. Retry before connecting this phone.' }); }
    finally { this.update({ busy: false }); }
  }
  async connect() {
    if (this.state.busy || !this.current()) return;
    this.update({ busy: true, error: '', message: '', job: null });
    try {
      const { token, platform } = await this.device.register();
      if (!this.current()) return;
      // Save the token securely before the request so interrupted registration
      // can be disconnected on the next launch. No JWT is duplicated here.
      this.record = { token, platform, userId: this.owner, registrationId: null };
      await this.storage.set(this.record);
      if (!this.current()) return;
      const result = await this.session.request('/push-tokens', { method: 'POST', body: { token, platform } });
      if (!this.current()) return;
      this.record = { ...this.record, registrationId: result.registrationId };
      await this.storage.set(this.record);
      this.update({ connected: true, message: 'This phone is connected. Send a test to check actual delivery.' });
    } catch (error) { this.update({ error: error.safeMessage || (error.status ? error.message : 'Could not connect notifications. Check phone permissions and your connection, then retry.') }); }
    finally { this.update({ busy: false }); }
  }
  async disconnect() {
    if (this.state.busy || !this.current()) return false;
    this.update({ busy: true, error: '', message: '' });
    try {
      if (this.record?.token) await this.session.request('/push-tokens', { method: 'DELETE', body: { token: this.record.token } });
      if (!this.current()) return false;
      await this.storage.clear(); this.record = null;
      this.update({ connected: false, job: null, message: 'Notifications disconnected for this account.' }); return true;
    } catch { this.update({ error: 'Could not disconnect this phone. Reconnect to the internet and retry. You can sign out anyway, but its generic notification registration may remain on the server.' }); return false; }
    finally { this.update({ busy: false }); }
  }
  async test() {
    if (this.state.busy || !this.current() || !this.record?.registrationId) return;
    this.update({ busy: true, error: '', message: '' });
    try {
      const job = await this.session.request('/push-tokens/test', { method: 'POST', body: { registrationId: this.record.registrationId } });
      this.update({ job, message: 'Test queued. Check your phone; provider acceptance alone does not confirm arrival.' });
    } catch (error) { this.update({ error: error.status ? error.message : 'Could not send a test. Reconnect notifications and retry.' }); }
    finally { this.update({ busy: false }); }
  }
  async check() {
    if (this.state.busy || !this.current() || !this.state.job) return;
    this.update({ busy: true, error: '' });
    try {
      const job = await this.session.request(`/push-tokens/jobs/${encodeURIComponent(this.state.job.jobId)}`);
      this.update({ job, error: job.error || '' });
    } catch { this.update({ error: 'Test status is unavailable. The service may have restarted. Check the phone, or send a new test after a minute.' }); }
    finally { this.update({ busy: false }); }
  }
}
