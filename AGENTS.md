# FocusLens — Agent Instructions

Before writing any code, read `SPEC.md` in full. It contains the complete architecture, the classification/state-machine logic, page-by-page UI spec, and a prioritized build order. Do not skip it or work from this file alone.

## Hard constraints (do not deviate without asking first)
- Plain HTML/CSS/JS only. No build tool, no bundler, no framework, no TypeScript.
- Face tracking via MediaPipe Tasks Vision, loaded by CDN `<script>` tag — not installed via npm.
- Camera processing remains entirely client-side; camera footage/images never leave the device. The user explicitly approved Tier 7's loopback Python backend, opt-in emailed summaries, and macOS app-name-only monitoring. These are narrow exceptions to the original client-only rule; they do not authorize camera uploads, screenshots, window titles, browser tabs, accounts, or a remotely exposed server.
- Audio cues are synthesized via the Web Audio API (`OscillatorNode`), never external audio files.
- Camera access via `getUserMedia` requires a secure context — plain `file://` will not work. Launch `start.command` (or `python3 server.py`) and test via `http://localhost:<port>`, not by opening the HTML file directly. A plain static server cannot provide Tier 7's APIs.

## Build order — this is the single most important rule in this project
`SPEC.md` Section 8 defines three priority tiers. **Build and verify Tier 1 completely before writing any Tier 2 code, and Tier 2 before Tier 3.** Tier 1 is the face/head-pose classification pipeline — it is the actual technical core of this project and must be tested against a real camera, not assumed correct from reading the code.

## Working process
1. After reading `SPEC.md`, before writing code: summarize your intended file structure and confirm your understanding of the Tier 1 state machine back to me. Flag anything in the spec that's ambiguous — don't silently guess.
2. Build Tier 1 only. Then stop and tell me exactly how to manually test it (which file to open, what to look for).
3. Wait for my feedback from real testing before touching Tier 2. The tolerance constants in `SPEC.md` Section 4 are starting guesses and will almost certainly need adjusting based on what I observe.
4. Repeat the same stop-and-verify pattern between Tier 2 and Tier 3.

## Approved Tier 7 scope

Tier 1/phone and Tier 2 real-camera/audio checkpoints were confirmed by the user. `TIER7_FINAL.md` supersedes all earlier Tier 6/7 additions. Build Sections 1 → 2 → 3 → 4, applying Section 0's exact `profileId` field throughout. The user approved additive UI integration as needed, while preserving existing behavior and leaving camera/classifier files unchanged. Section 5's OS permissions, real email delivery, Chrome installation, and Finder cold-start checks remain user-run acceptance steps. Do not claim mocks establish those outcomes.

## Phase 2 accounts — current scope

`PHASE2_ACCOUNTS_DATABASE.md` defines a new phase and supersedes the earlier no-accounts/no-database limitations for that work. Follow Section 8's order. The user confirmed hosting/OAuth are not set up and requested database + email/password locally first; shared JWT middleware follows those, before Google. Do not skip ahead to Google, migrate existing data endpoints, import browser history, or deploy until their ordered prerequisites are ready. Preserve earlier camera/classifier behavior. The Phase 2 checkpoint runs separately on localhost:8001; the existing local study app on :8000 is still Phase 1, not account-scoped.

Use bcrypt (never plaintext, never silent truncation), a secret from ignored environment configuration, and the single `require_auth` verifier for protected routes. User identity comes only from a verified signed JWT and the database, never a claimed body/query/header user ID. Public deployment requires HTTPS and managed PostgreSQL; no production SQLite fallback. Never log passwords, password hashes, tokens, or connection secrets. Legacy summaries/pacing must preserve unknowns without fabricated events, as explicitly approved by the user; that import is a later step, not part of this checkpoint.

## Phase 3 companion — approved change

Phase 2 hosting, account-scoped data, web Google auth, onboarding and hosted email have since been implemented on the existing Render service. `PHASE3_MOBILE_APP_V2.md` defines the companion phase. Follow its order: backend reachability → real email/password auth → read-only student screens → push registration and a real manual notification test → real alert delivery infrastructure → parent aggregates/UI → additional Google work. Existing web Google, camera, classifier, event and nudge behavior stays intact.

The first phone is an iPhone. After the free Home Screen companion checkpoint, the user explicitly requested **finishing the native Expo app** and testing the free Expo Go iPhone notification path. `mobile/` is the active native implementation; keep the existing `companion/` web version usable. The PWA keeps JWT access in memory only and must not use browser storage or a service worker for credentials. Native JWT storage remains `expo-secure-store`. No camera or microphone work belongs in either companion.

At the manual-push checkpoint, account-owned Web Push subscriptions, native Expo push registrations, and manual self-test delivery are allowed prerequisites. Do not connect the real 10-minute distraction trigger or claim physical delivery from provider acceptance, mocks, or a simulator. Wait for actual iPhone foreground/background feedback before progressing past that checkpoint. Keep notification text generic and private records out of worker caches. See `companion/README.md` and `mobile/README.md` for acceptance steps and the approved specification changes.

The user subsequently prioritized Google sign-in before that push checkpoint and explicitly chose **Keep Expo Go—add secure browser Google login** instead of a separately signed native development app. This supersedes Section 2's native transport for this Expo Go path and the earlier Google-last ordering only for that work. Use the hosted Google browser page plus a short-lived one-use exchange bound to the phone's private S256 verifier. No password, Google ID token, app JWT or private verifier belongs in a URL. Require the app to display and confirm the verified account before exchanging for access, retain `expo-secure-store`, existing password-linking checks and the original web cookie flow. Real push alerts/parent features still wait for their phone checkpoint.

On October 26, 2026, the user confirmed Google sign-in worked in both the Expo Go app and existing website, then confirmed both foreground and background test notifications arrived on the real iPhone. These checkpoints are passed; continue with alert delivery infrastructure → parent aggregates/UI. Cold-start secure sign-in restoration remains a separate acceptance check. Real parent-alert delivery still requires two accounts/devices; the self-test does not establish that outcome.
