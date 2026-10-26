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
