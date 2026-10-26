# Free Home Screen companion checkpoint

The user selected an iPhone Home Screen web app with Web Push instead of paying for native Apple push credentials. This is an approved change to `PHASE3_MOBILE_APP_V2.md`'s Expo delivery mechanism. The native Expo starter remains in `../mobile/`; the free companion is plain HTML/CSS/JS served by the existing account backend at `/companion/`.

Completed order: hosted backend reachability, real email/password auth, read-only student screens, then account-owned Web Push registration and a manual self-test. **Real distraction notifications, parent rollups/UI, and additional Google auth remain gated on real-device delivery.** There is no `/notify-parent` implementation and no modification to camera/classifier/nudge code at this checkpoint.

## Run locally

Use the existing Python environment and account database:

```sh
.venv/bin/pip install -r requirements.txt
.venv/bin/python configure_web_push.py --subject mailto:your-app-contact@example.com
.venv/bin/python -m flask --app backend:create_app db upgrade
.venv/bin/python accounts_server.py --port 8001
```

Open `http://localhost:8001/companion/`. A phone's localhost points to that phone, so **use the hosted HTTPS companion on the real iPhone**, not the laptop localhost address. Public hosting still requires managed PostgreSQL. Copy the `WEB_PUSH_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` settings from ignored `.env` into the existing hosting service's private environment settings; never put the private key in a public bundle or chat. Keep the key stable across deployments. Replacing it requires devices to disable/re-enable their subscriptions.

The backend derives the public VAPID key from the private P-256 key. Browser subscriptions include an endpoint and encryption keys; they are stored in `web_push_subscriptions` under the account selected by `require_auth`, with a unique endpoint hash. Only trusted browser push-provider HTTPS domains are accepted, and delivery does not follow redirects. Requests and delivery exceptions never log subscription keys, endpoint URLs, credentials or JWTs.

## iPhone acceptance

1. Open the hosted `/companion/` page in Safari. Add it to the Home Screen, then open the new icon. iOS 16.4 or later is required for this path.
2. Sign in using an existing email/password account. Check Dashboard, History, session detail, and Profile. A Google-only account has no email password; the existing web Google flow remains available separately at `/` until the later companion Google step.
3. Profile → Enable / reconnect. Allow notifications when the device asks. The permission request happens only on this tap.
4. Send test notification, then put the app in the background. Confirm the real `FocusLens test` notification appears. The provider's “accepted” result alone is **not** delivery proof. Render's free service can cold-start and take time to wake up.
5. Reopen the companion and check notification click behavior. Explicit Sign out clears private content immediately and attempts both browser unsubscribe and removal of the account-owned server record. Closing the app leaves the opted-in push subscription active, allowing background delivery.
6. Report whether foreground/background delivery worked before real distraction triggers or parent rollups are connected. The eventual family alert needs two real accounts and real devices; one browser/simulator cannot establish that outcome.

## Auth, storage, privacy

The companion uses the same signup/login/me routes, bcrypt policy, signed JWTs, and single server verifier as the web app. It verifies `/auth/me` before adopting a login. No caller-supplied user ID is used for ownership. It does not add cookie auth or loosen CORS.

The PWA keeps its token in memory only, without localStorage, sessionStorage, IndexedDB, CacheStorage, URLs, or a service-worker token. Closing/reloading may require signing in again; this is an intentional visible limitation. The native prototype instead uses `expo-secure-store`.

The service worker has no fetch/cache handler and never reads study history. Lock-screen notifications use generic text, without student names, events or scores. A manual test sends only a test identifier to the selected push provider. There are no automatic reports or alerts at this checkpoint. Camera/microphone/location access is disabled on companion responses.

Private rows disappear on logout/account changes and delayed responses are rejected. History supports 20-row pagination, newest first. Null statistics and imported summaries retain their unknown values; timelines separate unknown periods and pauses without inventing event records.

## Tests

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.mjs
cd mobile && npm test
```

Backend tests cover ownership, endpoint/key validation, encryption/decryption, VAPID signatures, non-redirecting delivery, cleanup of expired subscriptions, privacy of jobs, device limits, migration round trips, and fail-closed configuration. Worker tests cover generic messages, malformed payloads and fixed click destinations. Auth/progress tests exercise expired identities, logout races, UTF-8 password limits, null measurements, and timeline gaps. These establish code behavior, not physical iPhone delivery.

Sources: [Apple Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [pywebpush](https://github.com/web-push-libs/pywebpush).
