// Keep the bearer token out of URLs, HTML, logs, and persistent localStorage.
import { bootGoogleSignIn } from "./google-signin.js";
import { legacySnapshot, acknowledgeLegacy } from "./legacy-import.js";
import { bootAccountDashboard } from "./account-dashboard.js";
import { bootAccountSettings } from "./account-settings.js";
import { ACCOUNT_REQUEST_TIMEOUT_MS, ACCOUNT_SLOW_NOTICE_MS, ACCOUNT_SLOW_NOTICE, readAccountJson, authFailureMessage } from './account-network.js';
const TOKEN_KEY = "focuslens.auth.token.v1";

export class AccountClient {
  constructor({ fetcher = (...args) => fetch(...args), storage = () => sessionStorage,
    timeoutMs = ACCOUNT_REQUEST_TIMEOUT_MS, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) } = {}) {
    Object.assign(this, { fetcher, storage, timeoutMs, setTimer, clearTimer });
    this.generation = 0; this.token = null; this.storageAvailable = true;
    try { this.token = this.storage().getItem(TOKEN_KEY); } catch { this.storageAvailable = false; }
  }
  save(token) {
    this.token = token;
    try { token ? this.storage().setItem(TOKEN_KEY, token) : this.storage().removeItem(TOKEN_KEY); }
    catch { this.storageAvailable = false; }
  }
  logout() { this.generation++; this.abort?.abort(); this.save(null); }
  async restore() {
    if (!this.token) return null;
    const generation = ++this.generation;
    const abort = new AbortController(); this.abort = abort;
    const timeout = this.setTimer(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher("/auth/me", { headers: { Authorization: `Bearer ${this.token}` }, signal: abort.signal, credentials: "omit" });
      const data = await readAccountJson(response);
      if (generation !== this.generation) return null;
      if (abort.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
      if (response.status === 401) { this.logout(); throw new Error("Your session expired. Please sign in again."); }
      if (!response.ok || typeof data.id !== "string" || typeof data.email !== "string") throw new Error("Account access could not be verified. Please try again.");
      return data;
    } finally { this.clearTimer(timeout); }
  }
  async authenticate(kind, fields) {
    this.abort?.abort();
    const generation = ++this.generation;
    const abort = new AbortController(); this.abort = abort;
    const timeout = this.setTimer(() => abort.abort(), this.timeoutMs);
    let legacy;
    try { legacy=legacySnapshot(); } catch { this.migrationMessage="Old history could not be read. Your original browser data was kept."; }
    try {
      const response = await this.fetcher(`/auth/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, ...legacy?.payload }), signal: abort.signal, credentials: kind === "google" ? "same-origin" : "omit" });
      const data = await readAccountJson(response);
      if (generation !== this.generation) return null;
      if (abort.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
      if (!response.ok) {
        const failure = new Error(data.error || "Account access could not be completed.");
        failure.code = data.code;
        throw failure;
      }
      if (typeof data.token !== "string" || !data.user) throw new Error("Invalid account response.");
      this.save(data.token);
      if (data.migration?.status==="complete") {
        try { this.migrationMessage=acknowledgeLegacy(legacy,data.migration)?"Your old history was imported into this account.":"Your old history was imported. Newer browser data was preserved for a later import."; }
        catch { this.migrationMessage="Your old history was imported, but originals could not be cleared. Retrying is safe."; }
      } else if (data.migration) this.migrationMessage=data.migration.error;
      return data.user;
    } finally { this.clearTimer(timeout); }
  }
}

export function bootAccount(doc = document, client = new AccountClient()) {
  const get = (id) => doc.getElementById(id);
  let busy = false;
  let slowNotice;
  let googleSignIn;
  const dashboard = bootAccountDashboard(doc,client);
  let currentUser=null,viewGeneration=0;
  const settings=bootAccountSettings(doc,client,{onSaved:user=>{if(user?.id===currentUser?.id){status("Settings saved. You’re ready to start a session.");void dashboard.setUser(user);}}});
  function status(message) { get("account-status").textContent = message; }
  function error(message) { get("account-error").textContent = message || ""; get("account-error").hidden = !message; }
  function signedIn(user) {
    currentUser=user;const current=++viewGeneration;
    if (user) googleSignIn?.cancel();
    get("auth-forms").hidden = Boolean(user); get("signed-in").hidden = !user;
    for (const [id, value] of [["current-name", user?.displayName], ["current-email", user?.email], ["current-role", user ? user.role === "parent" ? "Parent account" : "Student account" : ""]]) get(id).textContent = value || "";
    status(user ? client.storageAvailable ? "Signed in on this browser tab." : "Signed in for this page. Browser storage is unavailable." : "Ready when you are.");
    void dashboard.setUser(null);
    void settings.setUser(user).then(complete=>{if(current===viewGeneration&&complete)void dashboard.setUser(user);});
  }
  function setBusy(value) {
    busy = value;
    clearTimeout(slowNotice);
    if (value) slowNotice = setTimeout(() => { if (busy) status(ACCOUNT_SLOW_NOTICE); }, ACCOUNT_SLOW_NOTICE_MS);
    get("auth-forms").querySelectorAll("input,select,button").forEach((input) => { input.disabled = value; });
    get("google-option").setAttribute("aria-busy", String(value));
  }
  googleSignIn = bootGoogleSignIn(doc, client, { onUser: signedIn, setBusy, isBusy: () => busy, onError: error, onStatus: status });
  function choose(kind) {
    if (busy) return;
    for (const mode of ["login", "signup"]) {
      get(`${mode}-form`).hidden = mode !== kind;
      get(`choose-${mode}`).setAttribute("aria-pressed", String(mode === kind));
    }
    doc.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; }); error(null);
  }
  for (const kind of ["login", "signup"]) {
    get(`choose-${kind}`).addEventListener("click", () => choose(kind));
    get(`${kind}-form`).addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !event.currentTarget.reportValidity()) return;
      const fields = { email: get(`${kind}-email`).value, password: get(`${kind}-password`).value };
      if (kind === "signup") Object.assign(fields, { displayName: get("signup-name").value, role: get("signup-role").value });
      googleSignIn.cancel();
      setBusy(true); error(null); status(kind === "signup" ? "Creating your account…" : "Signing in…");
      try {
        const user = await client.authenticate(kind, fields);
        if (user) { get("login-form").reset(); get("signup-form").reset(); signedIn(user); }
      } catch (failure) {
        error(authFailureMessage(failure, kind)); status(kind === 'signup' ? 'Account creation has not been confirmed.' : 'Sign-in has not completed.');
      } finally {
        get(`${kind}-password`).value = "";
        setBusy(false);
        if (!get("auth-forms").hidden) void googleSignIn.start();
      }
    });
  }
  get("sign-out").addEventListener("click", () => { client.logout(); googleSignIn.cancel(); signedIn(null); error(null); void googleSignIn.start(); });
  const ready = (async () => {
    if (!client.token) return googleSignIn.start();
    setBusy(true); status("Checking your sign-in…");
    try { signedIn(await client.restore()); }
    catch (failure) { signedIn(null); error(failure.name === "AbortError" ? "Could not check your sign-in. Please try again." : failure.message); }
    finally {
      setBusy(false);
      if (!get("auth-forms").hidden) await googleSignIn.start();
    }
  })();
  return { client, ready };
}

if (typeof document !== "undefined" && document.getElementById("auth-forms")) bootAccount();
