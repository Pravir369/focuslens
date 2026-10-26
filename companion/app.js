import { AuthSession } from './shared/session.js';
import { validatePassword } from './shared/api.js';
import { dateTime, duration, measured, newestFirst, percentage, recentStats, sessionSettings, STATE_COLORS, STATE_LABELS, timeline } from './shared/progress.js';
import { createPushController } from './push.js';

// Browser memory only. The native prototype uses Keychain/Keystore; a PWA has no
// SecureStore equivalent. Never fall back to localStorage or a cached JWT.
let memoryToken = null;
export const session = new AuthSession({ getToken: async () => memoryToken, setToken: async value => { memoryToken = value; }, clearToken: async () => { memoryToken = null; } });
const get = id => document.getElementById(id), content = get('content');
const push = createPushController(session);
let mode = 'login', page = 'dashboard', viewGeneration = 0, controller, history = [], nextOffset = null;
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function card(title, ...children) { const node = element('section', undefined, 'card'); node.append(element('h2', title), ...children); return node; }
function button(label, action, secondary = true) { const node = element('button', label, secondary ? 'secondary' : ''); node.type = 'button'; node.addEventListener('click', action); return node; }
function status(text) { get('app-status').textContent = text; }
function setMode(value) {
  mode = value; get('auth-form').reset(); get('auth-error').hidden = true;
  get('signup-name-group').hidden = get('signup-role-group').hidden = mode !== 'signup';
  get('auth-name').required = mode === 'signup';
  get('auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  get('auth-title').textContent = mode === 'signup' ? 'Start with an account.' : 'Welcome back.';
  get('auth-submit').textContent = mode === 'signup' ? 'Create my account' : 'Sign in to FocusLens';
  get('choose-login').setAttribute('aria-pressed', String(mode === 'login')); get('choose-signup').setAttribute('aria-pressed', String(mode === 'signup'));
}
get('choose-login').addEventListener('click', () => setMode('login')); get('choose-signup').addEventListener('click', () => setMode('signup'));
get('auth-form').addEventListener('submit', async event => {
  event.preventDefault(); get('auth-error').hidden = true;
  const submit = get('auth-submit'), fields = { email: get('auth-email').value.trim(), password: get('auth-password').value };
  if (mode === 'signup') Object.assign(fields, { displayName: get('auth-name').value.trim(), role: get('auth-role').value });
  try {
    validatePassword(fields.password); submit.disabled = get('choose-login').disabled = get('choose-signup').disabled = true; submit.textContent = 'Checking your account…';
    await session.authenticate(mode, fields);
  } catch (error) { get('auth-error').textContent = error.message; get('auth-error').hidden = false; }
  finally { fields.password = ''; get('auth-password').value = ''; submit.disabled = get('choose-login').disabled = get('choose-signup').disabled = false; submit.textContent = mode === 'signup' ? 'Create my account' : 'Sign in to FocusLens'; }
});
function startView() {
  controller?.abort(); controller = new AbortController(); const generation = ++viewGeneration;
  content.replaceChildren(card('Loading your progress…', element('p', 'The service may take a moment to wake up.', 'muted')));
  return { signal: controller.signal, current: () => generation === viewGeneration && session.state.phase === 'signedIn' };
}
function showError(error, retry) { content.replaceChildren(card('Couldn’t load this page.', element('p', error.message, 'error'), button('Try again', retry))); }
function sessionCard(row) {
  return card(`${percentage(row.engagedPct)} engagement`, element('p', dateTime(row.startTime)), element('p', `${duration(row.activeMs)} active · ${measured(row.distractionCount) ? `${row.distractionCount} distractions` : 'Distraction count not recorded'}`, 'muted'),
    ...(row.source === 'legacy-summary' ? [element('p', 'Imported summary · original events unavailable', 'muted')] : []), button('View session', () => showDetail(row.id)));
}
async function dashboard() {
  const view = startView();
  try {
    const data = await session.request('/sessions?limit=5', { signal: view.signal }); if (!view.current()) return;
    const stats = recentStats(data.sessions), intro = card('Your recent progress');
    if (stats.recent.length) intro.append(element('p', percentage(stats.averageEngagement), 'stat'), element('p', `Average engagement across ${stats.measuredCount} measured session${stats.measuredCount === 1 ? '' : 's'} in your latest ${stats.recent.length}.`));
    else intro.append(element('p', 'Your first session is still ahead. Complete a study session on your laptop, then refresh here.'));
    if (measured(data.suggestedMinutes)) intro.append(element('p', `Your pacing suggestion: ${data.suggestedMinutes} minutes.`, 'muted'));
    intro.append(button('Refresh progress', dashboard)); content.replaceChildren(intro);
    if (stats.recent.length) content.append(element('h2', 'Latest session', 'section-title'), sessionCard(stats.recent[0]));
  } catch (error) { if (view.current()) showError(error, dashboard); }
}
async function showHistory(offset = 0) {
  const view = startView();
  try {
    const data = await session.request(`/sessions?limit=20&offset=${offset}`, { signal: view.signal }); if (!view.current()) return;
    history = newestFirst([...new Map([...(offset ? history : []), ...data.sessions].map(row => [row.id, row])).values()]); nextOffset = data.nextOffset;
    content.replaceChildren(card('Your history', element('p', 'Your completed laptop sessions, newest first.'), button('Refresh history', () => showHistory())));
    if (!history.length) content.append(card('A fresh start.', element('p', 'No sessions yet. Study on your laptop to start your history.')));
    for (const row of history) content.append(sessionCard(row));
    if (nextOffset !== null) content.append(button('Load older sessions', () => showHistory(nextOffset)));
  } catch (error) { if (view.current()) showError(error, () => showHistory(offset)); }
}
async function showDetail(id) {
  page = 'history'; updateTabs(); const view = startView(); window.scrollTo(0, 0);
  try {
    const row = await session.request(`/sessions/${encodeURIComponent(id)}`, { signal: view.signal }); if (!view.current()) return;
    const recovery = measured(row.averageRecoveryMs) ? `Average recovery: ${duration(row.averageRecoveryMs)}.` : row.source === 'legacy-summary' ? 'Recovery information was not recorded in this imported summary.' : row.distractionCount === 0 ? 'No recovery needed.' : 'No recoveries recorded.';
    const settings = sessionSettings(row);
    content.replaceChildren(button('Back to history', () => showHistory()), card('Your session', element('p', dateTime(row.startTime)), element('p', percentage(row.engagedPct), 'stat'), element('p', `Engagement · goal ${percentage(row.goalEngagementPct)}`), element('p', `${duration(row.activeMs)} active · ${settings.ending}`), element('p', `${settings.policy} · ${settings.plan}`, 'muted')),
      card('Distractions & recovery', element('p', row.distractionCount === 0 ? 'No distractions this session.' : measured(row.distractionCount) ? `${row.distractionCount} distractions recorded.` : 'Distraction count not recorded.'), element('p', recovery), ...(measured(row.longestDistractionMs) && row.distractionCount !== 0 ? [element('p', `Longest distraction: ${duration(row.longestDistractionMs)}.`)] : []), element('p', 'Recovery includes only direct returns from distracted to engaged within an uninterrupted active segment.', 'muted')));
    const chart = card('Session timeline'), pieces = timeline(row);
    if (!pieces.length) chart.append(element('p', row.source === 'legacy-summary' ? 'Imported summary only. Original events were unavailable, so no timeline has been invented.' : 'No timeline recorded for this session.'));
    else {
      const bar = element('div', undefined, 'timeline'); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', pieces.map(piece => `${STATE_LABELS[piece.type]} for ${duration(piece.end - piece.start)}`).join(', '));
      for (const piece of pieces) { const part = element('span'); part.style.width = `${piece.widthPct}%`; part.style.backgroundColor = STATE_COLORS[piece.type]; bar.append(part); }
      const legend = element('div', undefined, 'legend');
      for (const type of new Set(pieces.map(piece => piece.type))) { const item = element('span'), swatch = element('span', undefined, 'swatch'); swatch.style.backgroundColor = STATE_COLORS[type]; item.append(swatch, document.createTextNode(STATE_LABELS[type])); legend.append(item); }
      chart.append(bar, legend, element('p', `From ${dateTime(row.startTime)} to ${dateTime(row.endTime)}. Pauses and unclassified gaps are shown separately.`, 'muted'));
      for (const event of row.events.filter(event => event.type === 'distracted' && event.triggerSource === 'cameraB')) chart.append(element('p', `Phone caught by desk camera at ${duration(event.start - row.startTime)} into the session.`, 'phone-catch'));
    }
    content.append(chart);
  } catch (error) { if (view.current()) showError(error, () => showDetail(id)); }
}
async function profile() {
  const view = startView(), user = session.state.user;
  try {
    const family = await session.request('/family-link', { signal: view.signal }); if (!view.current()) return;
    const links = card(user.role === 'student' ? 'Linked parents' : 'Linked students');
    if (!family.links.length) links.append(element('p', 'No family links yet.'));
    for (const link of family.links) links.append(element('p', link.displayName), element('p', link.email, 'muted'));
    content.replaceChildren(card('Your account', element('p', user.displayName), element('p', user.email), element('p', `${user.role === 'student' ? 'Student' : 'Parent'} account`, 'muted')), links,
      card('Study & report settings', element('p', 'Your laptop manages study duration, phone policy, and report recipients. This companion shows saved progress.')));
    void push.render(content, view.current);
  } catch (error) { if (view.current()) showError(error, profile); }
}
function updateTabs() { for (const node of document.querySelectorAll('[data-page]')) node.setAttribute('aria-pressed', String(node.dataset.page === page)); }
function navigate(value) { page = value; updateTabs(); window.scrollTo(0, 0); if (page === 'profile') void profile(); else if (session.state.user.role === 'parent') { startView(); content.replaceChildren(card('Parent account connected.', element('p', 'Weekly family summaries come after the real-device push checkpoint. Your student’s private session history is not exposed here.'))); } else if (page === 'history') void showHistory(); else void dashboard(); }
for (const node of document.querySelectorAll('[data-page]')) node.addEventListener('click', () => navigate(node.dataset.page));
get('sign-out').addEventListener('click', async () => {
  get('sign-out').disabled = true;
  const cleanup = push.disconnect(); await session.logout(); // Clear private content immediately, even while network cleanup is pending.
  const warning = await cleanup; get('sign-out').disabled = false;
  if (warning && session.state.phase === 'signedOut') status(warning);
});
session.subscribe(auth => {
  get('auth').hidden = auth.phase !== 'signedOut'; get('signed-in').hidden = auth.phase !== 'signedIn';
  controller?.abort(); ++viewGeneration; history = []; nextOffset = null; content.replaceChildren();
  if (auth.phase === 'signedIn') { push.resetIdentity(); status(`Welcome, ${auth.user.displayName}.`); get('auth-form').reset(); get('student-nav').querySelector('[data-page="history"]').hidden = auth.user.role !== 'student'; navigate('dashboard'); }
  else { status(auth.error || (auth.phase === 'loading' ? 'Checking your sign-in…' : 'Ready when you are.')); }
});
window.addEventListener('pagehide', () => { void session.logout(); });
void session.restore();
