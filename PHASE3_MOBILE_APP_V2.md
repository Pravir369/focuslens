# FocusLens — Phase 3: Mobile Companion App (v2 — aligned to actual backend)

Supersedes `PHASE3_MOBILE_APP.md` entirely. That version guessed at schema/endpoints before the real backend existed. This version is built against the actual documented API in `FocusLens_Planning_Handoff_2026-10-25.md` and resolves the architecture gaps directly — Google Sign-In's cookie dependency, missing push notifications, and the missing parent-facing endpoint — instead of leaving them as open questions.

## 0. Scope (confirmed, unchanged)

Companion app. Camera-based detection stays on the browser/laptop — MediaPipe's web library doesn't run in React Native's environment, and re-implementing it natively would mean rebuilding the hardest, most-tested part of the project from scratch. Mobile reads and writes against the same hosted Flask + PostgreSQL backend the web app already uses (`focuslens-accounts.onrender.com`).

## 1. Platform

React Native + Expo. JS carries over from the existing web app; Expo's push service is the main reason to prefer it here specifically.

## 2. Auth on mobile — resolved

**Email/password:** reuse `/auth/signup`, `/auth/login`, `/auth/me` exactly as documented. No backend changes needed.

**Google Sign-In — the actual fix, not a workaround:** the web flow's nonce travels in an HttpOnly cookie, which doesn't exist in a mobile app's environment. The fix is a second, equally standard transport for the same value — this is how native Google Sign-In normally handles nonce protection; cookies were only ever the *web-specific* convenience, not a requirement of the security property itself.

- New endpoint: `GET /auth/google/mobile-config` — same idea as the existing `GET /auth/google/config`, but returns `{ clientId, nonce }` directly in the JSON body instead of setting a cookie. The nonce is tracked server-side in the same in-memory challenge store already backing the web flow, same ~10-minute expiry.
- Mobile client passes that `nonce` into native Google Sign-In (`@react-native-google-signin/google-signin` or `expo-auth-session` both accept one), and Google embeds it in the returned ID token's claims.
- `POST /auth/google` (the existing endpoint, unchanged for web) gets one additive branch: if the request body includes a `nonce` field, verify the ID token's nonce claim against the server-stored value directly instead of reading it from a cookie. The existing web/cookie path is untouched — this is purely additive, same signature/audience/issuer/verified-email checks either way.
- Separate manual step, unavoidable regardless of implementation: register iOS and Android OAuth Client IDs in Google Cloud Console (distinct from the existing Web client), under the same project.

**Token storage:** `expo-secure-store`, not plain `AsyncStorage`.

## 3. Push notifications — resolved, complete net-new backend spec

Doesn't exist anywhere yet — this is the full addition.

**Schema:**
```
push_tokens
  id          PK
  user_id     FK -> users.id
  token       the Expo push token
  platform    "ios" | "android"
  created_at
```

**Endpoints**, following the same conventions as the rest of the documented API (JSON, camelCase, Bearer JWT):
```
POST /push-tokens
  Account JWT. Body: { token, platform }
  Registers/updates the logged-in user's push token.

POST /notify-parent
  Account JWT — called by the WEB APP's existing client-side logic, not a new server-side real-time monitor.
  Body: { sessionId, distractionDurationMs }
  Looks up active family_links for the session's student, finds registered push_tokens for each linked parent_user_id, sends via Expo's push API (https://exp.host/--/api/v2/push/send).
```

**Where the trigger logic lives:** the web app already runs a two-stage nudge escalation (15s quiet tone, 45s clearer chime). Add a third tier — **10 minutes** of continuous confirmed `distracted` state — at which point the web app calls `POST /notify-parent` once, debounced per event exactly like the existing two stages (never re-fired for the same ongoing distraction). This extends logic that already exists and is already tested, rather than building new real-time server-side monitoring.

**Delivery mechanism:** use the same background-thread job pattern already in `backend/services.py` for email reports — same architecture, Expo's API instead of Brevo's.

## 4. Parent rollup endpoint — resolved, complete net-new backend spec

Doesn't exist yet either. The existing privacy principle stays intact and is enforced here, not loosened: **a family link grants aggregate visibility only, never the event log.**

```
GET /family/:studentUserId/summary
  Account JWT. Caller must be a Parent with an existing family_links row to studentUserId — 403 otherwise.
  Returns: { sessionsThisWeek, avgEngagementPct, avgRecoverySpeedMs, trendVsPriorWeek }
```

Computed server-side from the student's existing `sessions` table — it already caches `avg_recovery_speed_ms` and `engagement_pct` per session, so this is a straightforward aggregate query (e.g. `AVG(...)`, `COUNT(...)` over the last 7 days), not a new data pipeline. No event-level or session-detail data is ever included in the response — this is the enforcement point for the privacy principle, not just a description of it.

## 5. Screens

**Student view:** Login/Signup, Dashboard (recent stats via `GET /sessions`), History (`GET /sessions`, `GET /sessions/:id` for detail), Profile/Settings (linked parents, logout).

**Parent view:** Login/Signup, Dashboard (the new `GET /family/:studentUserId/summary` — weekly rollup, explicitly not a live or per-session feed), Link a Student (reuses the already-built `POST /family-link`), Notification settings.

## 6. Build order

1. Confirm the hosted backend is reachable (it already is — `focuslens-accounts.onrender.com`).
2. Scaffold the Expo project; get email/password login working against the real `/auth/login` and `/auth/me` first.
3. Student dashboard + history screens — read-only against existing endpoints, lowest risk, build before anything else.
4. Push token registration (`expo-notifications` + `POST /push-tokens`) — confirm a manually-triggered test notification actually arrives before wiring it to real distraction logic.
5. Backend: `push_tokens` table, `POST /push-tokens`, `POST /notify-parent` (Section 3).
6. Backend: `GET /family/:studentUserId/summary` (Section 4).
7. Parent dashboard screen + the student-side link flow.
8. Mobile Google Sign-In (Section 2) — last among auth work, after email/password is confirmed solid on mobile, same sequencing principle used for every auth phase so far.

## 7. Honest risks — kept, not softened

- Push notification permission prompts and delivery timing are the most likely source of first-pass bugs — budget real device-testing time, not just "add the library."
- Testing the parent-notification path end to end needs two real accounts on two real devices — there's no way to verify this from one machine.
- The mobile Google Sign-In addition is new, untested server code sitting next to the existing, working web flow — test the web path again after adding it, to confirm the addition didn't regress what already works.
