/* No fetch handler and no caches: JWTs, passwords, and study records are never
 * stored by this worker. Push content is deliberately generic on the lock screen. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Still show a visible, generic notification. */ }
  const test = payload.kind === 'test', testId = typeof payload.testId === 'string' && /^[a-f0-9-]{36}$/.test(payload.testId) ? payload.testId : null;
  event.waitUntil((async () => {
    await self.registration.showNotification(test ? 'FocusLens test' : 'FocusLens update', {
      body: test ? 'Your test notification arrived. Open FocusLens to continue setup.' : 'A family progress update is available. Open FocusLens to view it.',
      icon: '/icon-192.png', badge: '/icon-192.png', tag: testId || 'focuslens-update', data: { testId },
    });
    if (testId) for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'focuslens-test-received', testId });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('/companion/', self.location.origin).href;
    for (const client of await self.clients.matchAll({ type: 'window' })) if (new URL(client.url).pathname.startsWith('/companion/')) return client.focus();
    return self.clients.openWindow(url);
  })());
});
