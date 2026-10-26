import { bootGoogleSignIn } from './google-signin.js';

export function bootGoogleCompanion(doc = document, location = window.location, fetcher = (...args) => fetch(...args), overrides = {}) {
  const flowId = new URLSearchParams(location.search).get('flow'), get = id => doc.getElementById(id);
  let busy = false;
  const error = message => { get('bridge-error').textContent = message || ''; get('bridge-error').hidden = !message; };
  async function request(path, body) {
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetcher(path, { credentials:'same-origin', redirect:'error', signal:abort.signal,
        ...(body ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || 'Google sign-in could not be completed. Restart in the app.'), { code:result.code });
      return result;
    } finally { clearTimeout(timeout); }
  }
  if (!flowId || !/^[A-Za-z0-9_-]{43}$/.test(flowId)) {
    get('auth-forms').hidden = true; error('Start Google sign-in from the FocusLens app. This link is incomplete.');
    get('bridge-status').textContent = 'Return to the app to start again.'; return { ready:Promise.resolve() };
  }
  const client = { authenticate: async (_, fields) => {
    const result = await request('/auth/google/companion/verify', {flowId, idToken:fields.idToken, ...(fields.password === undefined ? {} : {password:fields.password})});
    if (result.verified !== true) throw new Error('Google verification did not complete. Restart in the app.');
    return {verified:true}; // No app JWT is returned to or saved by this page.
  } };
  const flow = bootGoogleSignIn(doc, client, {
    onUser() { get('auth-forms').hidden = true; get('bridge-complete').hidden = false; get('bridge-status').textContent = 'Google verified. Return to FocusLens to confirm your account.'; },
    onError:error, onStatus:message => { get('bridge-status').textContent = message; }, isBusy:()=>busy,
    readyMessage:'Choose your Google account. New accounts use the account type chosen in the app.',
    setBusy(value) { busy = value; get('google-option').setAttribute('aria-busy',String(value)); get('google-link-password').disabled=value; },
    getConfig:async () => {
      const config = await request('/auth/google/companion/config?flow='+encodeURIComponent(flowId));
      if (!config.clientId?.endsWith('.apps.googleusercontent.com') || typeof config.nonce !== 'string' || !config.nonce || !/^\d{6}$/.test(config.verificationCode) || !['student','parent'].includes(config.role)) throw new Error('Google configuration could not be verified. Restart in the app.');
      get('verification-code').textContent = config.verificationCode; get('google-role').value = config.role;
      get('bridge-status').textContent = 'Match the code, then choose your Google account.';
      return config;
    }, ...overrides,
  });
  return { flow, ready:flow.start() };
}
if (typeof document !== 'undefined' && document.getElementById('bridge-status')) bootGoogleCompanion();
