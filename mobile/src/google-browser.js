// The verifier stays in memory on this phone, never in the browser URL/storage.
const PREFIX = '/auth/google/companion';
export class GoogleBrowserLogin {
  constructor(session, { makeProof, openBrowser }) {
    this.session = session; this.makeProof = makeProof; this.openBrowser = openBrowser;
    this.active = true; this.sequence = 0; this.pending = null; this.listeners = new Set();
    this.state = {phase:'idle', busy:false, error:'', message:'', code:'', user:null};
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  update(values) { if (this.active) { this.state = {...this.state, ...values}; for (const listener of this.listeners) listener(this.state); } }
  current(sequence) { return this.active && sequence === this.sequence && this.session.generation === this.authGeneration && this.session.state.phase === 'signedOut'; }
  async request(action, body) { return this.session.api.request(PREFIX+'/'+action, {method:'POST',body}); }
  async start(role) {
    if (this.state.busy || this.pending || !this.active) return;
    const sequence = ++this.sequence; this.authGeneration = this.session.generation;
    this.update({busy:true, error:'', message:'Opening Google sign-in…', user:null});
    try {
      const {verifier,challenge} = await this.makeProof();
      if (!this.current(sequence)) return;
      const config = await this.request('start',{challenge,role});
      if (!this.current(sequence)) return;
      if (!/^[A-Za-z0-9_-]{43}$/.test(config.flowId) || !/^\d{6}$/.test(config.verificationCode)) throw Error('Invalid sign-in configuration.');
      this.pending = {flowId:config.flowId,verifier};
      this.update({phase:'pending',code:config.verificationCode,message:'Finish Google sign-in in the browser, then tap Done or return to FocusLens.'});
      await this.openBrowser(this.url());
      if (this.current(sequence)) await this.refresh(sequence);
    } catch (error) { this.failure(error); }
    finally { this.update({busy:false}); }
  }
  url() {
    // The API origin is validated by ApiClient. No server-supplied redirect,
    // verifier, token, email, password or custom app scheme goes into this URL.
    return this.session.api.baseUrl+PREFIX+'?flow='+encodeURIComponent(this.pending.flowId);
  }
  failure(error) { this.update({error:error.status ? error.message : 'Google sign-in could not finish. Check your connection and retry from the app.'}); }
  async refresh(sequence) {
    const result = await this.request('check',this.pending);
    if (!this.current(sequence)) return;
    if (result.status === 'ready' && typeof result.user?.id === 'string' && typeof result.user.email === 'string' && ['student','parent'].includes(result.user.role)) {
      this.update({phase:'ready',user:result.user,message:'Check this Google account, then continue to sign in.'});
    } else if (result.status === 'pending') this.update({phase:'pending',message:'Google sign-in is not finished yet. Reopen the browser to finish, then check again.'});
    else throw Error('Invalid sign-in response.');
  }
  async check() {
    if (this.state.busy || !this.pending || !this.current(this.sequence)) return;
    this.update({busy:true,error:''});
    try { await this.refresh(this.sequence); } catch (error) { this.failure(error); }
    finally { this.update({busy:false}); }
  }
  async reopen() {
    if (this.state.busy || !this.pending || !this.current(this.sequence)) return;
    const sequence=this.sequence; this.update({busy:true,error:''});
    try { await this.openBrowser(this.url()); if (this.current(sequence)) await this.refresh(sequence); }
    catch (error) { this.failure(error); } finally { this.update({busy:false}); }
  }
  async confirm() {
    if (this.state.busy || this.state.phase !== 'ready' || !this.pending || !this.current(this.sequence)) return;
    const proof=this.pending, expectedId=this.state.user.id;
    this.update({busy:true,error:'',message:'Signing you in securely…'});
    try {
      await this.session.authenticateExternal(async () => {
        const result = await this.request('finish',proof);
        if (result.user?.id !== expectedId) throw Error('Account identity changed.');
        return result;
      });
      this.pending = null;
    } catch (error) {
      this.pending = null;
      this.update({phase:'idle',user:null,code:'',message:'Restart Google sign-in to try again.'}); this.failure(error);
    } finally { this.update({busy:false}); }
  }
  async cancel() {
    if (this.state.busy) return;
    const proof=this.pending; ++this.sequence; this.pending=null;
    this.update({phase:'idle',busy:true,user:null,code:'',error:'',message:''});
    try { if (proof) await this.request('cancel',proof); } catch { /* Expires in ten minutes; no access was adopted. */ }
    finally { this.update({busy:false}); }
  }
  dispose() {
    this.active=false; ++this.sequence; const proof=this.pending; this.pending=null; this.listeners.clear();
    if (proof) void this.request('cancel',proof).catch(()=>{});
  }
}
