# FocusLens — Final Build Spec: Remaining Work

**This file supersedes and replaces `TIER6_EXPANSION.md`, `ACCOUNT_READY_CONVENTIONS.md`, and `TIER7_MAC_PACKAGING.md`. Delete or ignore those three — having multiple overlapping spec files risks conflicting instructions. This is the single authoritative source for everything left to build today.**

Build order: Section 0 is a convention applied throughout, not a separate build step. Then Section 1 → 2 → 3 → 4, in that order. Each is independently shippable — stop after any of them if time runs out. Section 5 is manual steps for you, not the coding agent.

---

## Section 0 — Foundational convention: apply this in every section below

A future phase (not today) will add real Google-authenticated accounts, a real database, and a mobile app sharing those same accounts. Nothing below builds any of that — no auth, no database schema, no mobile work today. The only thing to do now is avoid choices that make that future phase harder than it needs to be.

**The one real idea:** on first app load, generate a random ID once and store it — `localStorage.setItem('focuslens_profile_id', crypto.randomUUID())` if it doesn't already exist. This is **not real authentication**, it's not secure, and anyone could fake it — that's fine for a same-day local app. Its only purpose: every piece of data stored or sent today is already shaped as "belonging to a profile," so when real accounts exist later, you swap *where this ID comes from* (a local UUID → a verified Google user ID) without touching the data shape anywhere else.

**Apply the exact same field name, `profileId`, everywhere it appears below** — Section 1's stored history, Section 2's email payload, Section 3's window-status payload. Inconsistent naming today is free to avoid now and real cleanup work later.

**Server routes (Section 2 and 3) should be RESTful and JSON-only** — e.g. `POST /sessions`, not ad hoc one-off shapes. This is what lets a future mobile app call the same API surface a real backend would expose. Server-side storage today (in-memory or a local file) is disposable — don't spend time today designing a "real" schema; that changes completely once real accounts exist. Only the JSON shape matters now.

---

## Section 1 — Personalized session pacing (build first)

**What it does:** suggests a session length based on the user's own past sessions, extending the recovery-speed work from Tier 5, using data already in the event log.

**Data needed:** for each completed session, `timeToFirstDistraction` = (timestamp of the first confirmed `distracted` event) − (session start time). A session with zero distraction events is "no data point" for this calculation, not zero.

**Persistence:** after each session ends, append `{ profileId, date, timeToFirstDistraction }` to a `localStorage` array. No History screen UI needed beyond this array unless it already exists.

**Suggestion calculation**, run when Session Setup loads:
```js
const history = getSessionHistory().filter(h => h.profileId === getCurrentProfileId());
if (history.length === 0) {
  suggestion = null; // show default UI, no suggestion yet
} else {
  const times = history.map(h => h.timeToFirstDistraction).sort((a,b) => a-b);
  const median = times[Math.floor(times.length / 2)];
  suggestion = Math.max(5, Math.min(45, roundToNearest5(median))); // floor 5min, ceiling 45min
}
```

**UI change, Session Setup screen only:** if `suggestion` exists, pre-select that value in the session-length control and show one line: "Based on your past sessions, a ~X minute block tends to work well for you." Stays fully editable. No history yet → existing default UI, unchanged.

**Nothing else changes** — no camera, classifier, or event-logging format changes. This reads the existing log and computes one number.

---

## Section 2 — Email session reports (build second)

**What it does:** after a session ends, optionally email the Summary-screen data (headline stats, Tier 5 pattern tip, a text version of the timeline) to the student and, optionally, a second address.

**Server addition:** `POST /send-report` on the existing local server, accepting `{ profileId, sessionSummary, recipientEmails: [...] }`. Uses `smtplib` with a sending account:
- A Gmail account (or similar) with an **app password** generated specifically for this — not the account's real login password.
- Store the app password in a local config file (e.g. `.env`) **explicitly excluded from version control.** Never commit a real credential.

**UI addition, Summary screen only:** one or two email input fields plus a "Send Report" button. Opt-in per session — typed each time, nothing auto-sent or stored as a standing subscription.

**Reliability:** sending can be slow or fail. Don't block the UI — show "Sending…" then success/failure. A failed send must never crash or freeze the Summary screen.

**Content:** reuse existing summary-rendering logic — a simple HTML email with the same stats and tip text is enough.

---

## Section 3 — Window/app-based off-task detection (build third)

**What it does:** adds a third independent signal to the existing fusion logic — not camera-based, not screen-content-based. Checks which application/window has focus against a list the student configures, and treats a mismatch as an off-task signal, the same way Tier 4 added Camera B.

**Why this instead of a screen-content AI model:** solves the same problem (detect non-study computer activity) without any model, local or remote, and is strictly more private — it only ever reads which app/window is frontmost, never what's displayed inside it. State this explicitly in the demo: "this reads the active window title only — it never captures screen content."

**Implementation (macOS — confirm before building):** a small Python script, run alongside the local server, polls the frontmost application every ~2–3 seconds via AppleScript:
```bash
osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'
```
Browser tab title too, if feasible without much extra effort — otherwise app-name-only is a fine first version.

**Classification:** before a session, the user sets a short allow-list (e.g., "Google Docs, Notion, Khan Academy"). Ship a hardcoded default blocklist too (YouTube, Instagram, TikTok, Discord, Steam, common games) so it behaves sensibly even with an empty allow-list. Matches allow-list → on-task. Matches blocklist, or matches neither → off-task. (Matching neither defaults to off-task — an honest, simple allow-list model, not a guess-every-legitimate-app model.)

**Server addition:** `POST /active-window-status`, accepting `{ profileId, appName, windowTitle, isOnTask }`; store only the latest value, same pattern as Tier 4's `/latest-frame`.

**Fusion into the existing raw-state logic** — one more OR'd condition, same pattern as Tier 4:
```
if (no face detected on Camera A)        → rawState = "away"
else if (eyesClosed)                     → rawState = "eyes_closed"
else if (phoneVisible_CameraA OR phoneVisible_CameraB OR windowOffTask) → rawState = "distracted"
else if (pose inside a zone)             → rawState = "engaged"
else                                      → rawState = "distracted"
```
Tag these events `triggerSource: "window"` — this is what lets Tier 5's pattern tip and timeline marker distinguish a window-based catch from a phone-based or look-away one, since that logic already branches on `triggerSource`.

**Resilience — same rule as Camera B:** script not running or stale → `windowOffTask` evaluates to `false` (no data = no signal, not an error), wrapped in try/catch. Camera A's pipeline must keep working regardless.

**State this limit honestly if asked:** this detects which app/window has focus, not activity within an ambiguous app — e.g. an allow-listed "Chrome" window with a distracting tab open wouldn't be caught unless tab-title detail was implemented. Name it directly; it's an honest scope boundary.

---

## Section 4 — Mac packaging & reliability (build fourth, once Sections 1–3 are solid)

No detection logic — this is about launching cleanly on demo day.

**4a. One-action startup script.** Create `start.command` in the project root (double-clickable in Finder, no manual terminal/chmod needed on demo day itself):
```bash
#!/bin/bash
cd "$(dirname "$0")"
python3 server.py &
SERVER_PID=$!
if [ -f "window_monitor.py" ]; then
  python3 window_monitor.py &
fi
open "http://localhost:8000"
echo "FocusLens running. Close this window or press Ctrl+C to stop."
wait $SERVER_PID
```
Adjust filenames/port to match the real project structure. Run `chmod +x start.command` once in Terminal — after that, double-click only.

**4b. Installable standalone window (PWA).** Add `manifest.json` in the project root:
```json
{
  "name": "FocusLens",
  "short_name": "FocusLens",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```
Link in `index.html`'s `<head>`: `<link rel="manifest" href="manifest.json">`. Two placeholder PNG icons (192x192, 512x512) are enough — not being judged on logo design. In Chrome: address bar → install icon → "Install FocusLens" → opens as its own window from the dock.

---

## Section 5 — Manual steps for you, not the coding agent

**Camera permissions have two gates on macOS:** the browser's own prompt, and System Settings → Privacy & Security → Camera, which must have your browser explicitly checked. Verify this now, not live.

**If Section 3 was built:** the AppleScript call needs Automation/Accessibility permission — System Settings → Privacy & Security → Automation, with Terminal (or whatever runs `window_monitor.py`) explicitly allowed to control "System Events." Click through the first-run dialog now, and confirm the script actually receives real app names afterward, not silent failure.

**Cold-start test:** fully quit everything, then double-click `start.command` from Finder exactly as you would on demo day. If it only works from an already-open terminal but not from a true cold start, that's the real bug to fix — a cold start is what demo day looks like.
