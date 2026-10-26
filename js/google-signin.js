// Google's ID token stays in memory and is sent only in a JSON POST to our API.
// Only our server-issued bearer token is saved by AccountClient.
let identityLoading;
export function loadGoogleIdentity(doc = document, win = window) {
  if (win.google?.accounts?.id) return Promise.resolve(win.google.accounts.id);
  if (identityLoading) return identityLoading;
  identityLoading = new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = "https://accounts.google.com/gsi/client"; script.async = true;
    const fail = () => {
      clearTimeout(timeout); script.remove(); identityLoading = null;
      reject(new Error("Google sign-in could not load. Check your connection and retry."));
    };
    const timeout = setTimeout(fail, 15000);
    script.onload = () => {
      if (!win.google?.accounts?.id) return fail();
      clearTimeout(timeout); resolve(win.google.accounts.id);
    };
    script.onerror = fail;
    doc.head.append(script);
  });
  return identityLoading;
}

export async function googleConfig(fetcher = (...args) => fetch(...args)) {
  const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetcher("/auth/google/config", { credentials: "same-origin", signal: abort.signal });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "Google sign-in is unavailable. Please retry.");
    if (typeof config.clientId !== "string" || !config.clientId.endsWith(".apps.googleusercontent.com") || typeof config.nonce !== "string" || !config.nonce) {
      throw new Error("Google sign-in configuration could not be verified.");
    }
    return config;
  } finally { clearTimeout(timeout); }
}

export function bootGoogleSignIn(doc, client, { onUser, setBusy, isBusy, onError, onStatus,
  loadIdentity = () => loadGoogleIdentity(doc), getConfig = () => googleConfig(client.fetcher),
  readyMessage = "Use your Google account, or sign in with email below. New accounts use the role selected above." }) {
  const get = id => doc.getElementById(id);
  let generation = 0, credential = null, identity;
  const googleStatus = message => { get("google-status").textContent = message; };
  function cancel() {
    generation++; credential = null;
    get("google-link-password").value = ""; get("google-link-form").hidden = true;
    identity?.disableAutoSelect();
  }
  async function submit(password) {
    if (!credential || isBusy()) return;
    const current = generation;
    setBusy(true); onError(null); onStatus("Checking your Google sign-in…");
    try {
      const fields = { idToken: credential, role: get("google-role").value };
      if (password !== undefined) fields.password = password;
      const user = await client.authenticate("google", fields);
      if (current === generation && user) { cancel(); onUser(user); }
    } catch (failure) {
      if (current !== generation) return;
      if (failure.code === "password_required") {
        get("google-link-form").hidden = false;
        googleStatus("An account with this email already exists. Confirm its FocusLens password to link it.");
        get("google-link-password").focus();
      } else {
        onError(failure.name === "AbortError" ? "Google sign-in timed out. Please retry." : failure.message);
        if (failure.code === "google_restart") {
          cancel(); get("google-retry").hidden = false; get("google-button").replaceChildren();
        }
      }
      onStatus("Sign-in has not completed.");
    } finally {
      get("google-link-password").value = ""; setBusy(false);
    }
  }
  async function start() {
    if (isBusy()) return;
    cancel(); const current = generation;
    get("google-retry").hidden = true; get("google-button").replaceChildren();
    googleStatus("Loading Google sign-in…");
    try {
      const config = await getConfig();
      identity = await loadIdentity();
      if (current !== generation) return;
      identity.initialize({ client_id: config.clientId, nonce: config.nonce, auto_select: false,
        ux_mode: "popup", callback: response => {
          if (current !== generation || isBusy() || get("auth-forms").hidden) return;
          if (typeof response.credential !== "string" || !response.credential) { onError("Google did not return a sign-in. Please retry."); return; }
          credential = response.credential; void submit();
        } });
      identity.renderButton(get("google-button"), { type: "standard", theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 300 });
      googleStatus(readyMessage);
    } catch (failure) {
      if (current !== generation) return;
      googleStatus(failure.name === "AbortError" ? "Google sign-in timed out. Please retry." : failure.message);
      get("google-retry").hidden = false;
    }
  }
  get("google-retry").addEventListener("click", () => { void start(); });
  get("google-link-cancel").addEventListener("click", () => { if (!isBusy()) { cancel(); void start(); } });
  get("google-link-form").addEventListener("submit", event => {
    event.preventDefault(); if (event.currentTarget.reportValidity()) void submit(get("google-link-password").value);
  });
  return { start, cancel };
}
