function bytes(value) { const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)); return Uint8Array.from(binary, character => character.charCodeAt(0)); }
const iPhoneOrIPad = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export function createPushController(session) {
  let registration, subscriptionId = null, lastTestId = null, epoch = 0, message = '', busy = false, statusNode, buttons = [];
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ready = supported ? navigator.serviceWorker.register('/companion/sw.js', { scope: '/companion/' }).then(value => { registration = value; return navigator.serviceWorker.ready; }).then(value => { registration = value; return true; }).catch(() => false) : Promise.resolve(false);
  const config = session.api.request('/web-push/config').catch(() => ({ configured: false }));
  function say(text) { message = text; if (statusNode?.isConnected) statusNode.textContent = text; }
  function setBusy(value) { busy = value; for (const button of buttons) button.disabled = value; }
  const valid = (userId, generation, operation) => session.state.phase === 'signedIn' && session.state.user.id === userId && session.generation === generation && operation === epoch;
  async function connect() {
    if (busy) return;
    const userId = session.state.user.id, generation = session.generation, operation = ++epoch;
    let created = false, sub;
    try {
      if (iPhoneOrIPad() && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) throw Error('First add FocusLens to your Home Screen in Safari, then open its icon to enable notifications.');
      if (!supported) throw Error('This browser does not support Web Push. Use Safari on an up-to-date iPhone and add FocusLens to your Home Screen.');
      setBusy(true);
      // Request directly from this tap, before awaiting network or worker setup.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (!valid(userId, generation, operation)) return;
      if (permission !== 'granted') throw Error('Notifications are off. You can allow them in this app’s notification settings on your device, then retry here.');
      const settings = await config;
      if (!settings.configured || !await ready) throw Error('Web Push setup is not available yet. Please retry after the server is configured.');
      if (!valid(userId, generation, operation)) return;
      sub = await registration.pushManager.getSubscription();
      if (!sub) { sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(settings.publicKey) }); created = true; }
      if (!valid(userId, generation, operation)) { if (created) await sub.unsubscribe(); return; }
      const result = await session.request('/web-push/subscriptions', { method: 'POST', body: { subscription: sub.toJSON() } });
      if (!valid(userId, generation, operation)) { if (created) await sub.unsubscribe(); return; }
      subscriptionId = result.subscriptionId; say('This device is connected. Send a test, then check that it appears on your iPhone.');
    } catch (error) { if (created) try { await sub?.unsubscribe(); } catch { /* Reconnect can retry. */ } if (valid(userId, generation, operation)) say(error.message); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    const operation = ++epoch, token = session.token; subscriptionId = lastTestId = null;
    let localRemoved = false, cloudRemoved = false, sub;
    try {
      if (!await ready) return '';
      sub = await registration.pushManager.getSubscription();
      if (!sub) return '';
      localRemoved = await sub.unsubscribe();
      for (const notice of await registration.getNotifications()) notice.close();
    } catch { /* Attempt server removal even if the browser unsubscribe failed. */ }
    if (sub && token) try { await session.api.request('/web-push/subscriptions', { method: 'DELETE', token, body: { endpoint: sub.endpoint } }); cloudRemoved = true; } catch { /* Local unsubscribe also invalidates delivery. */ }
    const warning = !localRemoved && !cloudRemoved ? 'Notifications could not be disconnected. Turn them off in your device’s notification settings.' : '';
    if (operation === epoch) say(warning || 'Notifications are disconnected on this device.'); return warning;
  }
  async function sendTest() {
    if (busy) return;
    const userId = session.state.user.id, generation = session.generation, operation = ++epoch;
    try {
      if (!subscriptionId) throw Error('Connect notifications on this device first.');
      setBusy(true); say('Sending one test notification…');
      const result = await session.request('/web-push/test', { method: 'POST', body: { subscriptionId } });
      if (!valid(userId, generation, operation)) return;
      lastTestId = result.jobId;
      for (let count = 0; count < 20 && valid(userId, generation, operation); count++) {
        const job = await session.request(`/web-push/jobs/${encodeURIComponent(result.jobId)}`);
        if (!valid(userId, generation, operation)) return;
        if (job.status === 'failed') throw Error(job.error);
        if (job.status === 'accepted') { if (!message.startsWith('Test received')) say('The push provider accepted the test. Check your notification; provider acceptance alone does not confirm delivery.'); return; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (valid(userId, generation, operation)) say('The test is still pending. Check your notifications before trying again.');
    } catch (error) { if (valid(userId, generation, operation)) say(error.message); }
    finally { setBusy(false); }
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.source?.scriptURL !== new URL('/companion/sw.js', location.origin).href || event.data?.type !== 'focuslens-test-received' || event.data.testId !== lastTestId || session.state.phase !== 'signedIn') return;
    say('Test received on this device. Please also verify it appears when the app is in the background.');
  });
  async function render(parent, canRender = () => true) {
    const owner = session.state.user?.id, generation = session.generation;
    const settings = await config;
    if (!parent.isConnected || !canRender() || session.state.user?.id !== owner || session.generation !== generation) return;
    const card = document.createElement('section'); card.className = 'card'; const title = document.createElement('h2'); title.textContent = 'Notifications';
    const copy = document.createElement('p'); copy.textContent = 'Free Web Push works through your Home Screen app. Enable it only on a device where you want notifications. No study details appear on the lock screen.';
    statusNode = document.createElement('p'); statusNode.className = 'muted'; statusNode.setAttribute('role', 'status');
    statusNode.textContent = message || (!supported ? 'Web Push is unavailable in this browser.' : !settings.configured ? 'The server’s Web Push credentials still need setup.' : 'Notifications stay off until you enable them.');
    const row = document.createElement('div'); row.className = 'row'; buttons = [];
    for (const [label, action] of [['Enable / reconnect', connect], ['Send test notification', sendTest], ['Disable notifications', async () => { if (busy) return; setBusy(true); try { await disconnect(); } finally { setBusy(false); } }]]) {
      const button = document.createElement('button'); button.textContent = label; button.type = 'button'; button.className = 'secondary'; button.disabled = busy || !supported || (label !== 'Disable notifications' && !settings.configured); button.addEventListener('click', action); row.append(button); buttons.push(button);
    }
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'Manual tests only at this checkpoint. Real distraction alerts are not connected yet.';
    card.append(title, copy, statusNode, row, note); parent.append(card);
  }
  return { render, disconnect, resetIdentity: () => { ++epoch; subscriptionId = lastTestId = null; message = ''; statusNode = null; buttons = []; busy = false; } };
}
