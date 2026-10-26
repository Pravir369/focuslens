# FocusLens — Phase 2: Accounts, Database, Full Auth System

This is a new phase, separate from the CAC submission build (`AGENTS.md`/`SPEC.md`/`TIER7_FINAL.md`). It replaces the disposable, spoofable `profileId` convention from Phase 1 with real, server-verified user identity. Unlike earlier tiers, this is not time-constrained — build it correctly, including the security requirements below, rather than taking shortcuts.

## 0. Two manual prerequisites — not code, do these first

**Hosting account.** The existing local Flask dev server only works on your own machine. A mobile app (or anyone not on your laptop) needs a real, publicly reachable backend. Recommend **Render** or **Railway** — both have a free/cheap tier sufficient for this project, and both provide HTTPS automatically on their default domain, which matters (see Section 1). Set up an account and a new web service now, before the coding agent starts — it'll need somewhere to deploy to.

**Google Cloud OAuth client.** For "Sign in with Google" to work, you need a registered OAuth Client ID. In Google Cloud Console: create a project (or use an existing one), go to APIs & Services → Credentials → Create OAuth Client ID (type: Web application), add your hosting URL (from above) as an authorized origin/redirect. You'll get a **Client ID** and **Client Secret** — treat the secret like a password, never commit it.

## 1. Hard security constraints — non-negotiable, not a style preference

- **Never store plaintext passwords.** Hash with `bcrypt` (the Python `bcrypt` library) before storing. Never log a password, hashed or not, anywhere.
- **Never commit secrets** — Google Client Secret, JWT signing key, database connection string, hosting credentials. All via environment variables, loaded from a `.env` file that is explicitly gitignored.
- **All authenticated endpoints verify identity server-side from a cryptographically signed token — never trust a client-submitted user ID.** This is the core difference from Phase 1's `profileId`, which was deliberately insecure and disposable. Every protected route must extract the user from a verified JWT, not from a field the client claims in its request body.
- **HTTPS only for anything beyond local dev.** Render/Railway provide this by default on their domains — don't disable it or serve auth traffic over plain HTTP once deployed.
- **Minimum password requirements:** at least 8 characters. Don't over-engineer this — a small project doesn't need a password-strength scoring library, just a basic length check.

## 2. Stack

Continue in **Flask**, consistent with the existing codebase — this is additive to the server you already have, not a rewrite.

- **Flask-SQLAlchemy** — ORM, database models
- **Flask-Migrate** (Alembic) — schema migrations, so the schema can evolve properly instead of hand-editing the database later
- **bcrypt** — password hashing
- **PyJWT** — issuing and verifying JWT tokens
- **google-auth** (Python package) — verifying Google ID tokens server-side
- **Database:** SQLite is fine to start (simple, zero extra setup, fine for this scale) — but confirm your chosen host (Render/Railway) supports persistent SQLite storage, since some platforms wipe local disk on redeploy. If it doesn't, use the host's managed PostgreSQL instead (both platforms offer a free Postgres tier) — check this before building, it changes the connection setup.

## 3. Database schema

```
users
  id              PK
  email           unique, nullable if google-only signup method exists without email... (in practice Google always provides email, so this can stay NOT NULL)
  password_hash   nullable (null if the account was created via Google only)
  google_id       nullable, unique (null if the account was created via email/password only)
  display_name
  role            enum: "student" | "parent"
  created_at

family_links
  id              PK
  parent_user_id  FK -> users.id
  student_user_id FK -> users.id
  created_at
  -- a parent can link to multiple students; a student can (in theory) have multiple linked parents

sessions
  id                    PK
  user_id               FK -> users.id  (the student whose session this is)
  start_time
  end_time
  goal_minutes
  goal_engagement_pct
  -- summary stats computed server-side from events, or cached here after session ends:
  avg_recovery_speed_ms
  engagement_pct
  distraction_count
  longest_distraction_ms

events
  id              PK
  session_id      FK -> sessions.id
  type            enum: "engaged" | "distracted" | "drowsy" | "away"
  trigger_source  nullable: "cameraA" | "cameraB" | "window" | null
  start_time
  end_time
  duration_ms
```

## 4. Auth endpoints

```
POST /auth/signup
  body: { email, password, displayName, role }
  - hash password with bcrypt before storing
  - create user row
  - return a signed JWT (see Section 5)

POST /auth/login
  body: { email, password }
  - look up user by email, verify password against stored hash with bcrypt
  - wrong email or wrong password -> same generic "invalid credentials" error either way (don't reveal which one was wrong — minor but real security practice)
  - return a signed JWT

POST /auth/google
  body: { idToken }  // from the client-side Google Sign-In flow
  - verify idToken server-side using google-auth's id_token.verify_oauth2_token, against your Google Client ID
  - extract email, google sub (unique Google user id), name from the verified token — never trust any Google user info sent directly from the client without this verification step
  - find existing user by google_id, or by matching email (link an existing email/password account to Google if emails match), or create a new user if neither exists
  - return a signed JWT

GET /auth/me
  - requires valid JWT (see Section 5 middleware)
  - returns the current user's id, email, displayName, role
```

## 5. JWT handling

On successful signup/login/google-auth, issue a JWT: `{ userId, role, exp: <expiry, e.g. 7 days> }`, signed with a secret key from an environment variable (generate a long random string once, store it in `.env`, never hardcode it in source).

Client (web now, mobile later) stores the token and sends it as `Authorization: Bearer <token>` on every request to a protected route.

Build a single reusable auth-check function/decorator used by every protected route — don't duplicate token-verification logic across endpoints. It should: read the `Authorization` header, verify the JWT signature and expiry, and attach the resulting `userId` to the request context for the route handler to use. A missing or invalid token → 401, and the route handler never runs.

## 6. Data endpoints — now authenticated, scoped to the real user

Replace the old `profileId`-tagged, client-trusted data flow with these, all requiring a valid JWT:

```
POST /sessions
  - creates a session row for request.userId (from the verified token, never from the request body)

PATCH /sessions/:id
  - closes out a session: end_time, final summary stats, and bulk-inserts its events
  - must verify the session belongs to request.userId before allowing the update — one user must never be able to write to another user's session by guessing an id

GET /sessions
  - returns request.userId's own past sessions only
  - this is what Section 1 of TIER7_FINAL.md's personalized-pacing calculation should now read from, server-side, instead of client-side localStorage — the real benefit: pacing history now follows the user across devices/browsers instead of being stuck in one browser's local storage

POST /family-link
  - body: { studentEmail }  (initiated by a logged-in parent account)
  - creates a family_links row connecting the parent (from the token) to the student account matching that email
  - keep this simple for now: no invite-acceptance flow required, a direct link by email is enough for this scope

POST /send-report
  - same as Phase 1, but: if the session's user has a linked parent (via family_links), default the parent's email field to that linked parent's stored email instead of requiring it to be typed in every time. The student can still override or add additional recipients.

POST /active-window-status
  - same as Phase 1, but scoped to request.userId from the verified token instead of a client-submitted profileId
```

## 7. Migrating existing localStorage data on first login

This is the payoff of Phase 1's `profileId` groundwork — don't skip it, it preserves a user's existing session history across the transition instead of losing it.

On first successful signup or login, the client should check for an existing `focuslens_profile_id` and any locally-stored session history tagged with it (from Phase 1's Section 1). If found, send it along with the signup/login request: `{ ...normalAuthFields, localProfileId, localSessionHistory }`. Server-side, on successful account creation, bulk-insert that local history into the new `sessions`/`events` tables under the new `user_id`. After a successful migration, clear the local `profileId` data so it isn't re-imported on a future login.

## 8. Build order

1. Database models + migrations (Section 3) — get this right first, everything else depends on it.
2. Email/password signup + login (Section 4, first two routes) — simpler than Google OAuth, verify the whole auth flow works end-to-end before adding Google.
3. JWT middleware (Section 5) — build once, apply everywhere.
4. Google OAuth route — only after the manual Google Cloud setup (Section 0) is actually done.
5. Migrate the data endpoints (Section 6) to require auth and scope to `userId`.
6. The localStorage migration-on-first-login flow (Section 7).
7. Deploy to real hosting (Section 0's Render/Railway account) and confirm the whole flow works against the deployed version, not just localhost — this is a real, separate verification step, not optional polish.
