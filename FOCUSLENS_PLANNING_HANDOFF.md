# FocusLens Technical and Product Planning Handoff

Snapshot date: October 25, 2026, America/New_York. Application baseline: commit `e726fe0`, including the deployed account onboarding and three-recipient settings update.

FocusLens is a browser study companion that estimates engagement from calibrated head positions, eye-closure readings, visible phones, and optional foreground-app evidence. It runs timed study sessions, gives gentle reminders during sustained distraction, and summarizes how quickly the user returns to engagement. It is an engagement estimate, not a measurement of thoughts, comprehension, productivity, or medical drowsiness.

The current product has a hosted account application with persistent settings and study records, plus an older local-only application that remains available separately. Future planning should use the hosted application as the current account experience while preserving the existing camera pipeline and its privacy boundaries. This handoff describes current behavior; ideas under future planning are not implemented commitments.

## Product locations and governing documents

| Item | Current location or meaning |
| --- | --- |
| Hosted application | https://focuslens-accounts.onrender.com/ |
| Hosted study experience | https://focuslens-accounts.onrender.com/study |
| Source repository | https://github.com/Pravir369/focuslens — private repository |
| Local checkout | `/Users/pravirbrahmbhatt/FocusLens` |
| Local account application | `http://localhost:8001/`, launched with `accounts_server.py` |
| Local account study experience | `http://localhost:8001/study` |
| Older local-only application | `http://localhost:8000/`, launched with `start.command` or `server.py` |
| Core detector and session specification | `SPEC.md` |
| Repository constraints and acceptance gates | `AGENTS.md` |
| Optional USB desk camera specification | `TIER4_DUAL_CAMERA.md` |
| Summary presentation specification | `TIER5_INSIGHTS_UI.md` |
| Pacing, explicit reports, app monitoring, launcher specification | `TIER7_FINAL.md`, superseding earlier Tier 6/7 files |
| Account and database specification | `PHASE2_ACCOUNTS_DATABASE.md` |

Some older passages in `SPEC.md` and Phase 1 documentation say there are no accounts, no database, only local history, or only two report recipients. Those describe the earlier application. Phase 2 and the later onboarding request explicitly add hosted accounts, a database, saved preferences, and up to three recipients. Similarly, the original server was a Python standard-library server; Phase 2 adds a separate Flask application rather than assuming the old server was Flask.

The current detector loads the pinned MediaPipe package as browser ES modules from a CDN. It does not install MediaPipe through npm. References to a generic CDN script in early specifications should not be mistaken for a frontend build system.

## Product goals and user roles

### Student experience

A student creates an account, chooses study defaults and report recipients, calibrates screen and paper-note positions, and starts a timed session. They can pause or end without being trapped in a session. Summary emphasizes recovery speed, followed by engagement against a personal goal, distraction count, longest distraction, a timeline, and a fixed rule-based pattern tip.

The student can return on another browser or device to view saved summaries and receive a pacing suggestion based on account history. Each new session requires fresh calibration. A previous calibration is never reused across separate sessions.

### Parent experience

A Parent account can link a Student account by its registered email. The current scope uses direct linking, with no invitation or student acceptance step. Linked parents can be used as fallback report recipients when the student has not saved an explicit recipient list.

Parent accounts do not have a dashboard for browsing a linked student's sessions or watching their camera. Session APIs remain scoped to the signed-in account itself. A family link does not grant access to the student's event log. The current UI also does not prevent a Parent account from running its own study session.

Roles are selected during account creation, not established through identity checks proving a parental relationship. Existing users retain their stored role when they later sign in with Google.

### Product tone and limits

The interface treats distraction as normal and recoverable. Goals are personal targets, not grades. Away time is a legitimate observed break and is excluded from engagement percentage. No leaderboards, punishments, productivity rankings, or diagnostic claims are implemented.

The app does not know whether a visible phone is being used for learning. Its explicit phone policy resolves that ambiguity: Phone-free counts a visible phone, while Studying with phone ignores phone detection.

## Application structure and navigation

There are two primary HTML documents in the hosted application:

- `account.html` at `/`: authentication, onboarding, saved settings, account history, family links, import, and desktop-helper pairing.
- `index.html` at `/study`: a study workflow whose views are shown and hidden by JavaScript. Start, Calibration, Setup, Live Session, Summary, and History are views within this document, not separate server routes.

The normal journey is:

```text
Account access
  -> Create account or sign in with Google/email
  -> New or unfinished account: onboarding step 1 -> onboarding step 2
  -> Account dashboard
  -> Open study session
  -> Start -> camera permission and model loading
  -> Calibration -> Session Setup -> Live Session
  -> Pause -> manual Resume, or End
  -> Summary -> optional explicit email report
  -> History or New Session
  -> New Session always recalibrates
```

An unauthenticated visit to `/study` returns to account access. An authenticated account with unfinished onboarding returns to `/?setup=1`. The static study HTML itself is public; JavaScript checks account access before initializing the study app. Actual private data is protected by the backend JWT verifier, not by hiding HTML.

## Page details

### Account access page

**Route:** `/` or `/account.html`. **Main heading:** “A place for your progress.”

The page explains that completed sessions sync to an account, camera images and raw head-pose readings remain on the device, and old local summaries can be imported without inventing events. Sign in is the initial email form; Create account switches forms in place.

The email sign-in form contains email and password fields. Successful sign-in restores the account and loads saved preferences before making the study link available. Wrong email and wrong password return the same generic credentials error. Passwords are cleared from the form after an attempt.

The Create account form contains display name, email, password, and Student/Parent role. Password requirements are at least eight characters and at most 72 UTF-8 bytes; this prevents bcrypt from silently truncating a long password. Account creation signs the user in and opens onboarding automatically.

The Google area contains a role selector for a new Google-created account and Google's official Sign in with Google button. The browser receives a Google credential and submits it to FocusLens for verification. It does not submit a claimed name or email as authoritative identity.

If a verified Google email matches an existing password account, a separate inline form asks for the existing **FocusLens** password before linking. This is not a request for the Google password. Linking can be canceled, and Google initialization or expired-challenge errors have a retry path. An existing account's stored role is preserved.

Busy states disable duplicate auth submissions. Status and error messages are announced through accessible status/alert regions. A successful login is held for the current browser tab using sessionStorage, with a memory-only fallback if storage is blocked.

There is currently no password-reset page, email-verification flow for password signup, account-deletion page, or general profile editor.

### Onboarding step one

**Location:** the account page after new account creation or an unfinished setup. **Heading:** “Make FocusLens yours.”

The first step asks for:

| Setting | Default | Allowed saved values |
| --- | --- | --- |
| Default session length | 25 minutes | Whole minutes from 1 through 1440 |
| Engagement goal | 80% | Whole percentages from 0 through 100 |
| Phone policy | Phone-free | `phone-free` or `phone-allowed` |

The phone-policy explanation says a visible unused phone counts in Phone-free mode and that Studying with phone ignores phone detection. The duration explanation states that a personalized pacing suggestion can take precedence when history provides one.

**Next: report recipients** validates the step and advances without sending email. Step-one edits are not separately committed; the final save submits settings and recipients together.

Settings load from the account API. A load failure shows an inline error and **Retry loading settings**; it does not silently invent a completed setup. New users cannot open the study workflow until setup is saved.

### Onboarding step two

**Heading:** “Choose your report recipients.”

The second step asks where session reports should go. Gmail is suggested in the placeholder, but other valid email providers are accepted. It begins with the account's default address, which can be replaced; recipients do not have to be FocusLens users or the login email.

Users can keep one address or add a second and third. Each row has a visible label. Remove recipient is available when more than one row exists, rows renumber after removal, and **Add another recipient** disables at three. Added rows must contain valid email addresses before saving. The backend normalizes addresses and deduplicates identical addresses without regard to case.

**Back** returns to study defaults without discarding the entered recipients. **Save and continue** validates and persists all preferences under the verified account, marks onboarding complete, and reveals account access to the study workflow. Failed saves retain the entered values and offer another attempt.

The page explicitly explains that recipients are saved to the account and **nothing is emailed until Send Report is selected after a session**. There is no automatic subscription or scheduled report behavior.

The current onboarding requires at least one recipient to finish, even for someone who never intends to send reports. A “no report recipients” preference is not implemented.

### Saved settings editor

After onboarding, **Edit study and report settings** reopens the same two steps with saved values. **Cancel changes** closes the editor without saving. Existing accounts present before the onboarding migration keep their access and can use this editor; they are not forced through a new first-run gate.

Saved defaults are loaded when a study page initializes. Changing a recipient on the Summary form affects that report only. Changing settings in a separate tab does not automatically refresh preferences already loaded by an open study page.

### Signed-in account dashboard

The signed-in card shows display name, account email, role, **Open study session**, **Edit study and report settings**, and **Sign out**.

The history section displays recent completed sessions, with newest first in this dashboard. Columns are Ended, Study time, Engagement, and Recovery. It handles no saved sessions, no classified time, no distractions, and distractions with no qualifying recovery. Imported records are labeled **Imported summary**.

The dashboard also displays a suggested next block length when account history supplies a first-distraction timing. **Refresh history** reloads the account data. The current UI loads the latest 100 summaries; the API supports pagination, but the UI has no load-more control.

The dashboard includes three additional functional sections:

1. **Import old history:** choose a JSON export from the earlier local app. The source file remains intact. Imported summaries and pacing are preserved separately, with missing data remaining unknown.
2. **Family links:** a Parent account can enter a student's registered email and choose **Link student**. Student accounts see their linked parents, and Parent accounts see linked students. The interface does not expose student history to a parent. There is no unlink control or invitation flow.
3. **Optional desktop app monitoring:** a collapsed macOS section offers the helper ZIP, **Generate pairing code**, a two-minute code, and **Disconnect desktop helpers**. The section explains the four-hour pairing limit and app-name-only scope.

An email configuration message indicates whether report transport is configured on the service. It is not an inbox-delivery guarantee.

### Study Start view

**Route:** `/study`, Start view. **Heading:** “Make room to focus.”

The account adapter adds a signed-in identity card, save status, **Retry saving** when needed, **Account and family links**, and **End session and sign out**. The latter ends an active session, waits for saves, revokes desktop helpers, clears local auth access, and returns to the account page. Failed saving blocks that sign-out action so the user can retry.

The Start view explains local camera processing, model/library downloads, and account synchronization of confirmed state records. It does not promise zero network activity.

Phone policy is prefilled from saved settings and remains editable before the camera starts. The selected policy is locked during active camera/session work. **Begin** requests camera access with no microphone and starts camera/model initialization. **History** opens saved summaries without activating the camera.

In account mode, the old “save history on this device” controls are hidden. Completed sessions automatically save to the account. The same base HTML still contains Phase 1 copy and controls, but `study-entry.js` replaces or hides those in account mode.

Permission denial, missing camera, another app holding the camera, library download failure, WASM/runtime failure, face-model failure, and phone-model/worker failure are presented as errors with retry behavior. Phone-free mode does not silently bypass a failed phone detector.

### Calibration view

**Heading:** “Find your study positions.”

The user starts calibration and follows three prompts:

1. Look at the screen for 5 seconds.
2. Look down at notes as if writing for 5 seconds.
3. Glance to the side as if checking a phone for 3 seconds.

The view shows instructions, countdown, tracking quality, a small live preview, and inline errors. Each step requires valid face/pose data in at least 90% of processed frames. Only valid frames contribute to average pose. A tracking interruption fails that capture rather than counting unseen time.

Screen and notes averages become study-zone centers. The side-glance average is a validation sample, not an additional allowed zone: it must fall outside both zones. Overlap or insufficient detection produces an explanation and recalibration path.

Successful calibration advances to Setup. **Back / change policy** returns toward Start. Calibration is held only in memory. It is preserved during a pause within the same session, but every new session requires a fresh calibration.

### Session Setup view

**Heading:** “Choose your session.”

Session length offers 15, 25, 45, and Custom. Custom is a whole-minute numeric field. The saved default preselects a preset or Custom; when history supplies a pacing suggestion, that suggestion preselects the session length instead. The suggestion remains editable and is explained beside the control.

Engagement goal has synchronized numeric and range controls from 0–100%, prefilled from account settings. A sentence previews the chosen time and target. Per-session edits do not rewrite saved account defaults.

The optional **Desk camera / Camera B** area lets the user refresh video devices, choose a different USB webcam, and connect it. Camera A remains responsible for face tracking and calibration. B adds phone detection only and does not require separate face calibration. This area is unavailable in Studying with phone mode, where no phone model or desk phone camera is needed.

The optional macOS app area contains **Use my study-app list this session** and an app-name text area. Commas/newlines separate up to 20 names. Monitoring is optional and configured per session; the allowed-app list is not part of saved account preferences. A missing helper does not prevent starting a camera session.

**Start Session** unlocks Web Audio through that user action, starts the active countdown, creates the account session record, and enters Live Session. **Recalibrate** returns to calibration. Users should keep FocusLens visible beside their work, because hiding the page pauses the session.

### Live Session view

**Heading:** “Your study session.”

The main display contains remaining time, the current confirmed state, running engagement percentage, a current-reading explanation, distraction-source text when relevant, and desktop-helper status. The preview remains visible while tracking is active, with optional Camera B below Camera A.

The indicator is green for engaged, amber immediately on confirmed distracted, blue/gray for drowsy, and neutral gray for away. Before classification qualifies it says **Waiting for classification**. Before a scoring denominator exists it says **Waiting for classified time**.

Controls are **Pause**, **Resume** when paused, **End Session early**, **Stop camera** in the preview, and **Enable sound** when audio needs another user gesture. A sustained distraction can show the dismissible reminder “Still here? Tap to resume focus.” Dismissing it does not change the classified state.

Manual pause freezes countdown, scoring, and reminders while leaving camera readings available for readiness. Hidden tabs, Camera A loss, tracking failure, and processing interruptions also pause. A paused notice explains the reason and offers camera reconnection when appropriate. Reconnecting or showing the tab does not resume automatically: fresh readings and a manual Resume are required.

On pause, the current confirmed event closes. Resume opens a new active segment and waits for fresh classification. Previous phone/app evidence and candidate dwell are invalidated. Away is different from pause: away time is excluded from engagement percentage but the active session countdown continues.

A disconnected optional Camera B is dropped with a warning while Camera A continues. Retrying B requires pausing; **Use Camera A only** removes B. Failure of the shared phone runtime itself follows the main tracking-failure path.

Automatic completion ends at the exact active-time deadline. Ending early also produces a summary. Camera streams, inference resources, and audio resources are released at completion.

### Summary view

**Heading:** “Your session, at a glance.”

Summary shows completion/early-ending status, active study time, phone policy, and these main statements:

1. Average time to return to engagement, or **No distractions this session** / **No recoveries recorded**.
2. Engagement percentage against the goal, or **No classified time**.
3. Number of confirmed distraction events.
4. Longest observed distraction duration.

Recovery is the most prominent statistic. Additional source text can count phone-triggered events by camera and app-triggered events. A fixed rule-based pattern tip appears above the timeline; this is not a generated LLM response.

The horizontal timeline spans total wall time and distinguishes engaged, distracted, drowsy, away, paused, and unclassified intervals. Phone-related distracted spans have a dark amber inset marker; app-related spans have a purple marker. Camera A/B or app source is described in the details. Unclassified portions do not receive phone/app markers. **Timeline details** expands an accessible table of states and durations.

Account save status appears inline. A failed save keeps the completed session in tab memory and exposes **Retry saving** in the account card. Exact retries do not create duplicate completed sessions/events. Closing or reloading the tab can still lose unsaved records; this is not an offline synchronization queue.

The report form prefills all saved recipient addresses in three fields. Recipient 1 is required for the form; Recipient 2 and Recipient 3 are optional. Users can change them for this send without altering saved preferences. **Send Report** first ensures the session is saved, then sends the owned session ID and recipient list. The backend rebuilds report statistics and timeline from saved records.

Sending shows progress and polls delivery-job status. Provider acceptance is labeled as acceptance, not proof of inbox delivery. Failures and uncertain/partial delivery stay inline and advise checking before retrying. Saving settings, creating a family link, and ending a session never automatically send a report.

**New Session** reconnects and recalibrates. **View history** opens the study history view. **Change phone policy** returns to Start.

### Study History view

**Heading:** “Returning to focus, over time.”

This view is available from Start and Summary. It shows the latest fetched summaries oldest first, a recovery-speed SVG chart, and a descriptive comparison of the first and latest qualifying recovery values within that displayed set. Rows include end date, active study time, recovery average/count, engagement/goal, distraction count, and phone policy.

A missing recovery value is a chart gap, never zero. Imported summaries are labeled. An empty account prompts the user to complete a session. **Back** returns to the previous Start or Summary view.

Account mode hides the old local-storage enable/clear-history/clear-pacing controls. There is no current account-history deletion endpoint or pagination control in this view. Stored detailed sessions have an API retrieval route, but history rows do not open a full historical session-detail page.

### Camera preview and diagnostic panel

Camera A's preview is mirrored for the person looking at it; inference uses the unmirrored video. Phone boxes match the displayed preview. Optional Camera B's preview is unmirrored and its overlay uses that orientation.

**Detector diagnostics** is collapsed by default and exposes face presence; yaw, pitch, roll; left/right/average eye closure; phone confidence and age; B phone confidence and age; face frame rate; processing interruption count; raw reading/reason; candidate and dwell; confirmed state; calibration centers/quality; the confirmed event table; and session-record JSON.

These are debugging views of in-memory data. They do not upload camera frames or raw pose data. The panel is useful for validating axis signs, tolerances, freshness, hardware speed, and source attribution.

### Desktop helper and standalone shell

The desktop helper is a macOS command-line companion, not a separate native FocusLens GUI. The user downloads the ZIP from their account, extracts it, runs `connect-monitor.command`, and enters the one-use pairing code into a hidden prompt. Python 3 and appropriate macOS Automation permission are needed. Ctrl+C stops the helper. OS permissions remain user-controlled.

`manifest.json` and 192/512 icons provide a standalone browser-app shell, including local Chrome installation support. There is no service worker, offline model bundle, or native iOS/Android app. The local shell still needs its local server; the hosted account app still needs network APIs. Packaging metadata does not establish that every browser/device offers installation.

## Technical architecture

```text
Browser
  Camera A -> MediaPipe FaceLandmarker -> pose and eye readings
  Camera A and optional Camera B -> shared phone-detection worker
  Optional latest app evidence <- authenticated FocusLens API
  Readings -> classifier adapter -> dwell state machine
           -> confirmed event log -> session timer and metrics
           -> live UI, synthesized audio, summary and timeline

Browser account adapters -- HTTPS and Bearer JWT --> Flask on Render
  Auth / preferences / sessions / family / report jobs / helper pairing
                             |
                             +--> PostgreSQL: durable account and session records
                             +--> Brevo HTTPS API: explicitly requested email report
                             +--> Process memory: jobs, app leases, readings, pairings

macOS helper -- restricted JWT over HTTPS --> app-name monitoring endpoints

Camera frames, face matrices, raw pose, calibration, and phone boxes stay in browser.
```

### Technology choices

| Layer | Current implementation |
| --- | --- |
| Frontend | Plain HTML, CSS, JavaScript ES modules; no framework, bundler, TypeScript, or frontend build step |
| Face tracking | MediaPipe Tasks Vision 0.10.32, FaceLandmarker, CPU delegate, VIDEO mode, one face |
| Face outputs | Facial transformation matrix and face blendshapes, including left/right blink scores |
| Phone detection | MediaPipe ObjectDetector, CPU delegate, EfficientDet-Lite0 int8 v1, `cell phone` allow-list |
| Runtime/model distribution | Pinned jsDelivr package/WASM paths and Google's versioned model storage URLs |
| Camera acquisition | `getUserMedia`, video only, no microphone |
| Audio | Web Audio oscillators and gain envelopes; no audio files |
| Backend | Python, Flask, Flask-SQLAlchemy, Flask-Migrate/Alembic |
| Passwords and JWTs | bcrypt and PyJWT |
| Google verification | Google Identity Services in browser, `google-auth` on server |
| Production database | Managed PostgreSQL with psycopg |
| Local account database | SQLite in ignored `.instance/focuslens.sqlite3` |
| Production process | Gunicorn, one worker, four threads |
| Hosted email | Brevo transactional email over HTTPS |
| Local legacy email | TLS SMTP, including Gmail app-password configuration |
| Optional desktop reading | Python standard library plus macOS AppleScript app-name query |
| Tests | Native Node test runner and Python unittest; browser fixtures with controlled inputs |

Python packages are pinned in `requirements.txt`. Node is a development/test tool, not a production frontend requirement. The old standard-library server does not need the Flask dependency stack; the account server does.

Face inference currently runs synchronously from the browser's animation-frame loop on the interface thread. Phone inference is moved to its worker. This avoids adding object detection to that thread, but does not remove face-inference cost or guarantee smooth operation on slower hardware. A face-processing stall can cross the 500 ms interruption threshold and pause a session.

### Frontend integration design

`js/app.js` owns the established study flow and accepts dependency overrides. `js/entry.js` selects local legacy startup or the `/study` account adapter. `js/study-entry.js` restores auth, loads settings, provides account history/pacing stores, creates server sessions, wraps reporting and app evidence, and adds account-specific controls/copy.

This allows the account phase to retain the earlier classifier, calibration, event-log, timer, and audio behavior. Some account rendering currently depends on matching old paragraph text or existing element IDs. That is a maintenance coupling to consider before redesigning the base HTML.

## Detection and state machine details

### Pose and study zones

The pose helper reads MediaPipe's column-major 4×4 transformation matrix, removes scale, and extracts Euler angles with rotation convention `Rz(roll) * Ry(yaw) * Rx(pitch)`. Angles are degrees. Axis conventions are commented in `js/pose.js`; signs should be checked empirically in diagnostics when tuning a physical camera setup.

Only yaw and pitch define study zones. Each zone is rectangular, with independent starting bounds of ±15° yaw and ±12° pitch around its calibrated center. Angle differences handle wraparound. Roll is displayed but is not a zone boundary.

This is head-pose classification, not eye-gaze tracking. The app does not recognize a textbook, read a document, or verify what is on the screen.

### Raw classification precedence

The base classifier evaluates:

1. No face: raw `away`.
2. Missing usable pose/eye readings: unknown.
3. Average eye-closure score above 0.6: raw `eyes_closed`.
4. Missing calibration: unknown.
5. Phone-free: a fresh positive phone in A produces distracted with source `cameraA`; otherwise a fresh positive in B produces distracted with source `cameraB`.
6. Phone-free with no positive phone but missing/stale required A evidence: unknown.
7. Otherwise an in-zone pose is engaged; an out-of-both-zones pose is distracted.

The optional app adapter can supply positive off-task evidence when face/eye/calibration prerequisites are usable. Camera phone evidence wins a simultaneous source tie; otherwise fresh off-task app evidence produces distracted with source `window`. This can establish distraction while A's phone evidence is unknown, but cannot establish engagement from missing evidence. App evidence cannot override no face, unusable face data, or closed eyes.

Camera B is optional **positive** evidence. Missing B never proves phone absence and never blocks engagement by itself. Returning to engaged in Phone-free mode still requires fresh phone-absent evidence from A plus an engaged pose and no applicable off-task app evidence.

### Confirmation thresholds

| Destination | Continuous evidence required |
| --- | --- |
| Distracted | 3000 ms |
| Engaged | 1000 ms |
| Drowsy from raw eyes_closed | 1000 ms |
| Away | 1000 ms |

Raw readings do not directly create events or change the confirmed-state indicator. A candidate state and its start time are tracked separately. A changed raw state resets the candidate; unknown evidence also resets it. Entering a new source of the same raw distracted state does not restart the three-second dwell.

Before the first qualifying candidate, the confirmed state is unset and no engagement event is invented. A confirmed transition uses the confirmation timestamp, not the earlier candidate onset. This consistently underrepresents some physical distraction onset time; it is a relative behavioral metric, not precise ground truth.

Frame gaps over 500 ms, backward timing, hidden-page interruptions, and suspension clear pending dwell. Unobserved time is not continuous evidence. Brief unknown readings can leave a prior confirmed event open, while separate unclassified metadata excludes the unusable portion from scoring and disqualifies a recovery that crosses it.

### Phone inference lifecycle

Phone-free mode initializes the worker/model; Studying with phone does not require either. Starting values are a 250 ms sample interval, confidence at least 0.55, and a freshness window of 750 ms from actual capture time, not response arrival.

One module worker and one ObjectDetector instance serve both cameras. A/B sampling alternates within a combined maximum of four samples per second, with only one bitmap/inference request in flight globally. The detector's VIDEO inference clock increases globally, while evidence retains source-specific capture timestamps.

Transferred images are closed after processing and are not retained. Per-source generations reject results from before invalidation, source replacement, or pause. B must supply advancing video frames; repeatedly sampling a frozen image cannot keep a detection fresh indefinitely.

B capture/inference input failures drop B locally. Shared worker/runtime failure is a tracking failure. Loading stages distinguish library, WASM/runtime, face model, phone model, and worker/inference errors. The phone load timeout starts at 45 seconds.

Detection is limited by lighting, angle, size, occlusion, and field of view. A phone outside both camera views cannot be detected. A visible unused phone still counts in Phone-free mode.

## Session timing and metrics

### Event and metadata contracts

The in-memory confirmed event contract is:

```js
{
  type: "engaged" | "distracted" | "drowsy" | "away",
  start: timestampMs,
  end: timestampMsOrNull,
  duration: millisecondsOrNull,
  // Optional on source-tagged distracted events only:
  triggerSource: "cameraA" | "cameraB" | "window"
}
```

Events retain the source at confirmation. Changing cause while the same distracted event remains confirmed does not split it or rewrite its source. Source-free distracted events are treated as look-away events for the pattern tip.

Session metadata includes start/end, planned minutes, engagement goal, phone policy, end reason, and:

- `activeSegments`: `{start, end, eventStartIndex, eventEndIndex}`, separating uninterrupted active periods.
- `unclassifiedPeriods`: `{start, end}`, covering initial waiting or missing usable required observations.

Pause and unclassified are timeline categories, not new event types. Browser timing uses a monotonic-derived epoch clock. The account transport rounds a copy to integer milliseconds and recomputes copied durations; it does not mutate the original detector/event log.

### Timer and pause semantics

The countdown measures active unpaused session time. Initial waiting and unclassified time still consume active countdown time even though they do not count toward engagement. Away also consumes countdown time. Pause consumes neither countdown nor scoring time.

Pausing closes the current event and active segment. Resuming opens a new segment and starts unclassified until a fresh state qualifies. If a frame interruption is detected late, the app pauses at the last observed frame rather than scoring the missing interval. Ending while paused does not reopen an event or charge the paused duration.

### Engagement

```text
engagement percent = engaged observed ms /
                     (engaged + distracted + drowsy observed ms) * 100
```

Observed duration excludes overlapping unclassified periods. Away, pauses, and waiting without a confirmed event do not enter the denominator. A zero denominator yields null, not 0% or 100%.

### Recovery speed

A recovery requires a closed distracted event immediately followed by engaged at the same boundary, within the same uninterrupted active segment, with no unclassified time inside that distracted event. Its recovery duration is the whole qualifying distracted event's duration.

Distracted → away, distracted → drowsy, distraction interrupted by pause, distraction at session end, and distraction spanning unknown observations do not count as recoveries. They remain in the distraction count and timeline. Average recovery is the arithmetic mean of qualifying durations; no qualifying recoveries means null.

### Other summary calculations

- Distraction count counts confirmed distracted events.
- Longest distraction is the maximum observed distracted-event duration after unclassified overlap is removed.
- At or above goal is a pass; up to 10 percentage points below goal is near; further below is below goal. A null engagement score has no fabricated goal comparison.
- Timeline covers wall time, including separate pauses and unclassified gaps.
- Recovery values are formatted in seconds with useful decimal precision. The longest metric describes distraction, not the separate away state.

### Reminders

A confirmed distraction's first reminder is eligible at 15 seconds: a quiet 440 Hz sine tone, roughly 150 ms, gain 0.08. The second is eligible at 45 seconds: 440 and 554 Hz tones with gain 0.15 plus a dismissible banner. Amber begins immediately at confirmation, not at 15 seconds.

Each stage fires at most once per event. A delayed tick emits only the highest outstanding stage instead of stacking both sounds. There are no reminders during away, drowsy, pause, or currently unusable evidence. Audio unlock/failure is handled separately so the visual session remains usable.

### Pattern tip and pacing

The pattern tip counts phone-related distractions, app-related distractions, drowsy events, and source-free look-away distractions. Highest count wins, with tie order **phone, app, drowsy, look-away**. No matching events produces the no-distractions tip. These are fixed messages based on counts, not duration analysis or causal inference. The existing look-away wording mentions brief recovered lapses even though the selection rule does not require brevity or a recovery; this is a copy limitation for future review.

Pacing uses the first confirmed distracted event's start minus session start, in milliseconds. This definition includes earlier pauses; it is not accumulated active time. Sessions with no distraction contribute null and are excluded from the timing sample.

Sort non-null timings, choose the upper middle value for an even count, convert to minutes, round to the nearest five, and clamp to 5–45 minutes. With no timing data, use the saved onboarding duration, or 25 minutes if no custom default exists. The server calculates account pacing from all owned non-null completed timing records, including separately imported pacing records; it is not restricted to the 100 summaries shown by the UI.

## Database and persistence

### Database relationships

```text
users
  1 -> 0 or 1 user_settings
  1 -> many sessions -> many events
  parent user -> many family_links <- student user
```

There are five application tables plus Alembic's schema-version table. IDs are UUID strings except the settings primary key, which is also the owning user's UUID. Foreign keys and database constraints enforce relationships; relevant child records cascade when a user/session is deleted at the database level. There is no current user-facing deletion flow.

### Users table

`users` contains `id`, unique normalized `email`, nullable `password_hash`, nullable unique `google_id`, `display_name`, `role`, and `created_at`. At least one login method is required. Password-only users have a bcrypt hash; Google-only users can have no password hash. Public serialization exposes only ID, email, display name, and role.

### User settings table

`user_settings` contains `user_id` as primary/foreign key, `goal_minutes`, `goal_engagement_pct`, `phone_policy`, nullable JSON `recipient_emails`, and `onboarding_complete`.

New users without a settings row receive uncompleted defaults until they save. The migration inserts completed default rows for users already present, preserving access. Null recipients preserve the earlier fallback of self plus one linked parent for a student. Once an explicit recipient list is saved, it takes precedence over family defaults. Linking a parent later does not silently expand a saved list.

### Family links table

`family_links` contains `id`, `parent_user_id`, `student_user_id`, and `created_at`. The parent/student pair is unique and self-linking is disallowed. Application logic restricts creating links to a Parent account and selects a Student account by email.

### Sessions table

`sessions` contains:

| Field group | Columns and purpose |
| --- | --- |
| Identity | `id`, `user_id`, `created_at` |
| Timing and goal | `start_time`, `end_time`, `goal_minutes`, `goal_engagement_pct`, `phone_policy`, `end_reason` |
| Cached derived statistics | `avg_recovery_speed_ms`, `engagement_pct`, `distraction_count`, `longest_distraction_ms`, `recovery_count`, `active_ms` |
| Pacing | `first_distraction_ms` |
| Observation boundaries | JSON `active_segments`, JSON `unclassified_periods` |
| Import and retry metadata | `import_source`, `legacy_key`, `completion_key` |

Times and durations use milliseconds. Goal minutes and engagement percentage are numeric. `import_source` is `live`, `legacy-summary`, or `legacy-pacing`. Legacy rows may leave unavailable settings, start time, or derived statistics null instead of fabricating them.

### Events table

`events` contains `id`, `session_id`, `type`, optional `trigger_source`, `start_time`, `end_time`, `duration_ms`, and `position`. Database constraints restrict the four states, source tagging on distracted events only, ordered timestamps, and duration equal to end minus start. `position` preserves original event order.

The database receives closed events at session completion. It does not receive each camera frame or a continuous event-by-event live stream.

### Save and retry lifecycle

At Start Session, the browser assigns a client session UUID and posts the owned session settings. If registration fails, the study session can continue in memory and registration is retried before completion upload.

At completion, a PATCH supplies closed events, end reason/time, active segments, and unclassified periods. The server validates structure, allowed fields, ordered/nonoverlapping intervals, event-to-segment membership, explicit unknown gaps, and active time against the planned duration. It computes statistics itself rather than accepting claimed final scores.

An exact retry of the same creation/completion is safe. A completion digest identifies an already-committed payload; a different replacement for a completed record returns a conflict. Rows and bulk events commit together. Reads and writes select the session by both its ID and the verified account owner.

The server verifies identity and derives metrics, but it cannot prove that client-submitted events originated from an honest camera session. These records are self-reported browser evidence, not tamper-proof educational assessment.

### Durable and temporary data

| Data | Current storage |
| --- | --- |
| Users, password hashes, Google subject IDs | Database |
| Saved defaults and recipient list | Database |
| Completed account sessions, events, pause/unknown metadata | Database |
| Family links and imported summaries/pacing | Database |
| Unfinished session event log and calibration | Browser memory |
| Failed completion upload pending retry | Browser-tab memory |
| Account JWT | Browser sessionStorage with memory fallback |
| Camera images, phone bitmaps, matrices, raw poses, phone boxes | Transient browser processing; never uploaded or persisted by the app |
| Latest monitored app name, active lease, allow-list | Backend process memory |
| Pairing codes and paired-device bindings | Backend process memory |
| Helper's restricted token | Helper process memory |
| Report delivery jobs | Backend process memory, retained for roughly one hour subject to cleanup |
| Provider email contents/delivery records | Sent to Brevo and recipient mail providers; provider retention is separate from the app database |
| Old local summaries/pacing | localStorage on the older application's browser origin until migration/clearing |

Restarting the backend does not erase PostgreSQL account data, but does lose temporary jobs, leases, and pairings. Reloading a browser can lose an unfinished session or an unsaved completed session. An unfinished server session row may remain without events/end time and is excluded from normal completed-history queries.

## Authentication and security

Passwords are hashed with bcrypt at cost 12 in normal operation. Inputs longer than bcrypt's 72-byte limit are rejected explicitly. Credentials, password hashes, JWTs, signing keys, database connection strings, and email API keys must never be committed, logged, or included in planning attachments. This file intentionally contains no credential values.

Normal account JWTs are signed with HS256, expire after seven days, and include subject/user ID, role, issuer, audience, issue/not-before/expiry times, token ID, and token purpose. `require_auth` is the shared verifier for protected routes. It validates signatures/claims and loads the current database user and role before the handler runs. Claimed body/query/header user IDs are never ownership authority.

Tokens travel in Authorization headers, not URLs. Browser requests use same-origin application paths. Logout clears local access, but normal account JWTs do not currently have a server-side revocation list or refresh-token rotation. Deleted users or changed roles fail current-user checks; signing-key rotation also invalidates existing tokens.

Google verification checks real signatures, intended audience, issuer, expiry, verified email, stable subject, and a browser-bound nonce. The challenge is signed in an HttpOnly SameSite Strict cookie, Secure in production, with a ten-minute lifetime. Google's public client ID is configuration, not a secret; the current GIS credential callback flow does not need a Google client secret or OAuth redirect URL.

Production requires an HTTPS public origin and rejects SQLite fallback. Flask checks trusted hosts and origin/fetch-site constraints. Responses use no-store, MIME-sniffing protection, CSP, framing restrictions, and production HSTS. CSP permits the specific Google sign-in resources on account pages and the pinned vision/runtime/model resources on study pages. Private configuration, database files, Python source, directory listings, and test fixtures are not publicly served by the hosted app.

The general request limit is 2 MiB. Normal auth requests have a smaller 16 KiB limit unless carrying bounded legacy import data. Auth attempts are limited per process/IP, with a normal threshold of 20 attempts per minute. These controls do not replace a distributed abuse-protection design if the app scales.

Password signup does not currently verify control of the email address. Parent linking and report-address selection therefore should not be treated as verified relationship/recipient ownership. There is no current invitation acceptance, broad consent manager, or account recovery flow.

## API reference

Protected endpoints use the same verified-account JWT unless a restricted helper credential is specifically noted. Bodies are JSON and use camelCase fields. Examples name fields, not real credentials or private IDs.

### Authentication endpoints

| Method and path | Authentication and behavior |
| --- | --- |
| `POST /auth/signup` | Public, rate-limited. `{email,password,displayName,role}` creates a hashed-password account and returns app JWT plus public user. Can also carry approved legacy import fields. |
| `POST /auth/login` | Public, rate-limited. `{email,password}` returns app JWT/public user after verification; optional legacy import fields. |
| `GET /auth/google/config` | Public, rate-limited. Returns public client ID and nonce; sets challenge cookie. |
| `POST /auth/google` | Verified Google credential exchange. `{idToken,role?,password?}`; optional existing FocusLens password for linking and legacy fields. Returns app JWT/public user. |
| `GET /auth/me` | Account JWT. Returns the current database user's public identity. |

### Preferences and study records

| Method and path | Body or result |
| --- | --- |
| `GET /preferences` | Saved/fallback `{goalMinutes,goalEngagementPct,phonePolicy,recipientEmails,onboardingComplete}` for the verified account. |
| `PUT /preferences` | Requires exactly `{goalMinutes,goalEngagementPct,phonePolicy,recipientEmails}`; validates and marks setup complete server-side. |
| `POST /sessions` | `{clientSessionId,startTime,goalMinutes,goalEngagementPct,phonePolicy}`. Owner comes from JWT. New record is 201; identical existing registration can return 200. |
| `PATCH /sessions/:id` | `{endTime,endReason,events,activeSegments,unclassifiedPeriods}`. Closes an owned live session and calculates statistics. Client-supplied summary scores/identity are rejected. |
| `GET /sessions` | Own completed summaries, excluding pacing-only rows. Supports `offset` and `limit` up to 100, returns `nextOffset` and `suggestedMinutes`. Each returned page is ordered oldest first within the selected recent page. |
| `GET /sessions/:id` | Owned summary plus events and observation-boundary metadata. |
| `POST /imports/local` | `{localProfileId,localSessionHistory,localPacingHistory}` imports under verified ownership and returns acknowledgement counts. |

An event/segment/unknown array is capped at 20,000 rows, also subject to the total request size. The completion validator allows only `completed` and `ended-early` end reasons. A claimed completed session must reach its active-time goal within rounding tolerance.

Onboarding is a browser flow gate, not an extra authorization boundary in the session API. An authenticated API client can create a session without using the onboarding screens; it still cannot create or read another account's session.

### Family and reporting endpoints

| Method and path | Body or result |
| --- | --- |
| `GET /family-link` | Current account's linked people and effective report defaults. |
| `POST /family-link` | Parent only; `{studentEmail}` creates a direct link to a Student account. Duplicate links are safe. |
| `GET /report-config` | Indicates configured transport and configuration presence; does not expose credentials. |
| `POST /send-report` | `{sessionId,recipientEmails?}`. Requires an owned, ended, nonlegacy live session. Uses saved defaults if recipients are omitted, permits one to three addresses, rebuilds report server-side, returns a queued job with 202. |
| `GET /reports/:id` | Owner-only short-lived status with report ID, status, sent count, and safe error text. |

Reports include headline sentences, goal feedback, pattern tip, and a textual timeline; they do not attach images, calibration, or raw pose data. A report timeline is capped at 5000 rows, so a very dense otherwise-valid session can exceed report limits.

### Desktop-helper endpoints

| Method and path | Authentication and behavior |
| --- | --- |
| `POST /monitor/pair` | Account JWT. Creates a one-use pairing code valid for 120 seconds. |
| `POST /monitor/claim` | Rate-limited credential exchange using `{pairCode}`, without an account JWT. Consumes the code and returns a monitor-purpose JWT lasting up to four hours. |
| `GET /monitor/config` | Account or valid monitor JWT; returns the account's freshest active monitor lease and server time. A monitor JWT's permitted GET route is limited to this configuration. |
| `PUT /sessions/:id/activity` | Account JWT. `{revision,active,monitorEnabled,allowedApps}` updates the owned session lease. |
| `POST /active-window-status` | Monitor-purpose JWT only. `{sessionId,sessionRevision,appName,windowTitle,observedAt}`, with `windowTitle` required to be empty. Server derives on-task status from its saved allow-list. |
| `GET /active-window-status?sessionId=...` | Account JWT, owned session. Returns only fresh applicable evidence, otherwise unavailable. |
| `POST /monitor/revoke` | Account JWT. Removes the account's device bindings, pairing codes, leases, and latest readings. |

### Public operational routes and errors

`GET /health` returns application/phase information; it is not a database or email-delivery probe. `GET /downloads/FocusLens-monitor.zip` downloads helper source plus a public server address, never a user's token or service secret. JavaScript/CSS/manifest/icons are served from explicit allow-lists. The development-only account browser fixture is unavailable in production.

Missing/invalid auth produces 401. Parent-only denial can produce 403. Another account's session/job is generally 404 rather than a disclosure of its existence. Validation errors are 400, conflicting completed data is 409, oversized bodies 413, excessive auth/report requests are rate-limited or rejected, and an unconfigured report provider is 503. Unexpected server failures return a generic error without logging sensitive bound data.

## Desktop monitoring behavior

The macOS helper reads the frontmost **application name only** through the existing AppleScript helper. It never requests window titles, screenshots, screen recording, or browser-tab contents. It polls configuration and, when enabled and active, sends an app reading approximately every 2.5 seconds. It reads no app name while the account has no active enabled lease.

The browser refreshes/polls the signal around every two seconds. Leases expire after ten seconds without a heartbeat, and readings are fresh for seven seconds. Revisions and evidence boundaries invalidate stale results across pause/resume, changed configuration, and expired leases. A late stop from a previous session stays attached to that original session.

App-name matching trims whitespace and ignores case, with Chrome/Edge aliases. Explicit allow-list matches win; unknown or blocked names are off-task. An empty allow-list allows nothing. Allowing Google Chrome allows all Chrome tabs because tab contents are outside scope.

The helper stores its restricted JWT only in memory and does not follow redirects with credentials. A valid monitor token cannot read account identity, saved sessions, preferences, family links, or reports. It is tied to an in-memory device binding, so revocation or backend restart invalidates it. When multiple sessions are active for an account, the freshest applicable lease is selected; a full multi-device/concurrent-session policy is not implemented.

The helper uses server time for capture evidence, while browser freshness checks also use its local clock. Device/server clock skew and poor network latency are relevant real-world acceptance cases. Missing or stale app evidence is ignored, not treated as proof of engagement or a reason to halt the camera pipeline.

## Email delivery behavior

The hosted app uses Brevo's HTTPS transactional-email endpoint because the deployed free web-service setup blocks SMTP. The local legacy app can use configured TLS SMTP. A restricted Brevo credential and verified sender are configured through private environment settings; their values are not in source control or this file.

The server sends a separate message per recipient so addresses are not exposed through a shared To/CC list. The sender is the application's configured sender, not the logged-in recipient's Gmail account. End users do not provide Gmail passwords or grant mailbox access to receive a report.

Job processing occurs in a background thread. There is no durable message queue, scheduled report service, automatic retry, delivery webhook, or persistent provider message-ID tracking in the app. A worker restart can lose a job's status even if the provider accepted a message.

The account queue limits each owner to five jobs per ten minutes and keeps a bounded recent global job set. Brevo has its own account quota. Free-mail sender addresses may be rewritten to a compliant Brevo sending domain; a custom authenticated domain is a future deliverability decision.

One explicitly authorized synthetic test email was sent with the configured Brevo transport and the provider log showed delivery. Hosted report configuration and account report logic were separately checked. The three-recipient expansion was tested with mocked delivery and saved-prefill integration; three real messages were not sent as part of that update.

## Legacy application and migration

The older app at localhost:8000 is not automatically secured by signing into localhost:8001 or the hosted origin. Its local `profileId` is disposable metadata, not authentication. Its server must remain loopback-only and is not the public hosting entry point.

Legacy storage keys are `focuslens_profile_id`, `focuslens.history.v1`, and `focuslens.pacing.v1`. Old summary history is optional and bounded to 100 records, while pacing is stored separately. The legacy email form supports one or two per-send addresses, not saved three-recipient account settings.

On successful authentication at the same origin, the account client can attach a whitelisted snapshot of old summaries/pacing to the auth request. Existing signed-in accounts also have an import endpoint. Browser origins are isolated, so the hosted site cannot read a different localhost origin's storage.

For cross-origin migration, the local Start view's **Export old history for my account** downloads `FocusLens-history.json`; the signed-in account dashboard imports it. The file and local originals are retained until the user verifies/clears them. Same-origin browser originals are cleared only after full server acknowledgement and only if their raw snapshot has not changed; later writes and other profiles are preserved.

Imports are idempotent under the verified user using deterministic legacy keys. Legacy summary statistics remain marked summaries without invented Event rows. Pacing-only records preserve first-distraction timings without fabricated session settings. Failed authentication never authorizes import, and a malformed migration does not silently fabricate history or erase the source data.

## Hosting and operations

Render hosts the Flask web service and managed PostgreSQL in the same region, with external database access disabled in the Blueprint. Production gets the database connection and signing secret through environment configuration. The repository is private and automatic deploy-on-commit is off; releases are deliberately deployed after checks.

Startup runs Alembic migrations before Gunicorn with one worker and four threads. Current migrations are initial accounts/family/sessions/events, completion/event-order metadata, and account settings/onboarding. Do not replace migrations with `create_all()` or hand-edited production tables.

One worker is intentional because auth limits, report jobs, monitor leases, and pairing bindings are process-local. Multiple workers/instances would need shared state or a different design before they behave consistently. Reports and helper pairings are not durable across redeploys.

The current free PostgreSQL instance was provisioned with **November 24, 2026** as its expiration date. A durable storage/backup decision is required before relying on it beyond that date. Free web instances can sleep; a cold request can take around a minute. Browser auth/API timeouts may expire during cold startup and require retrying after the service wakes.

Render uses a TCP readiness probe for the current configuration; production HTTP requests still enforce HTTPS. `/health` does not verify database connectivity. The app does not currently include a formal backup/export/restore workflow, durable job recovery, centralized audit logging, analytics, error tracking, or an admin console.

Environment variable names include `JWT_SECRET_KEY`, `DATABASE_URL`, `FOCUSLENS_ENV`, `PUBLIC_ORIGIN`, `TRUST_PROXY`, `GOOGLE_CLIENT_ID`, `REPORT_TRANSPORT`, `BREVO_API_KEY`, `REPORT_FROM_EMAIL`, and optional `SMTP_*` values. Real values stay in ignored local configuration and hosting secrets.

Google's client is configured for the hosted origin and localhost origins, with External/Testing audience and an owner test account. Wider public Google sign-in requires reviewing that audience/test-user configuration. Actual Google consent/login with the owner's account remains a manual acceptance item; rendered buttons and signature-verification tests alone do not establish it.

## Source map

Paths below are relative to the repository root. These modules are useful starting points for future planning and review.

| Files | Responsibility |
| --- | --- |
| `account.html`, `account.css` | Account, onboarding, dashboard, family/import/pairing UI and styling |
| `index.html`, `styles.css` | Base study views, preview, summary, history, diagnostics, responsive styles |
| `js/entry.js`, `js/app.js` | Entry selection, study orchestration, view flow, model/stream lifecycle, interruption handling |
| `js/account.js`, `js/google-signin.js`, `js/account-api.js` | Auth UI/client, Google callback/linking, bearer API requests and expiry errors |
| `js/account-settings.js`, `js/account-dashboard.js` | Onboarding/editor, recipient rows, account history, family/import/pairing controls |
| `js/study-entry.js` | Account adapters for settings, history, pacing, sessions, reports and app evidence |
| `js/config.js` | Pinned vision/model paths, dwell/zone/eye/phone/frame-gap constants |
| `js/camera.js`, `js/desk-camera.js` | Primary and optional USB camera acquisition, cleanup, frame freshness |
| `js/tracking.js`, `js/pose.js`, `js/loading.js` | Face task, frame adapter/loop, Euler extraction, staged download/runtime errors |
| `js/calibration.js`, `js/classifier.js` | Calibration validation, study-zone test, raw classifier and dwell state machine |
| `js/phone.js`, `js/phone-model.js`, `js/phone-tracker.js` | Phone evidence interpretation, detector construction, shared A/B scheduling |
| `js/phone-worker.js`, `js/worker-runtime.js` | Worker inference, transferred-image cleanup, MediaPipe worker runtime bridge |
| `js/event-log.js`, `js/session.js` | Confirmed events, active countdown, segments, unknown intervals, metrics and timeline spans |
| `js/nudges.js`, `js/audio.js` | Reminder timing and synthesized Web Audio |
| `js/summary.js`, `js/insights.js`, `js/history-view.js` | Summary/timeline presentation, fixed tips, sentences, recovery chart/table |
| `js/history.js`, `js/profile.js`, `js/pacing.js`, `js/legacy-import.js` | Legacy local storage, profile metadata, pacing rules, export/import acknowledgement |
| `js/reports.js`, `email_reports.py` | Report UI/controller, summary serialization, content formatting, local TLS SMTP |
| `js/window-signal.js`, `js/window-fusion.js` | Fresh app evidence lifecycle and optional classifier adapter |
| `backend/__init__.py` | Flask factory, production guards, blueprints, CSP/security headers, static allow-lists/helper ZIP |
| `backend/models.py`, `migrations/` | Database schema and ordered Alembic migrations |
| `backend/auth.py`, `backend/google_auth.py`, `backend/tokens.py` | Password auth, Google verification/linking, single JWT verifier |
| `backend/preferences.py`, `backend/data.py` | Owned preferences, session/family/report/monitor/import API handlers |
| `backend/session_data.py`, `backend/report_data.py`, `backend/legacy.py` | Strict transport validation, server metrics/report derivation, legacy import |
| `backend/services.py` | Temporary jobs, HTTPS email transport, leases, devices and pair codes |
| `account_monitor.py`, `window_monitor.py`, `window_rules.py`, `connect-monitor.command` | Hosted paired helper, earlier local helper, app-name matching, helper launcher |
| `server.py`, `launcher.py`, `start.command` | Legacy loopback server and readiness/owned-process launcher |
| `accounts_server.py`, `render.yaml`, `requirements.txt` | Local account server, hosted deployment configuration, pinned Python dependencies |
| `manifest.json`, `icon-192.png`, `icon-512.png` | Browser standalone shell metadata/icons |
| `tests/` | JS/Python suites and controlled browser/model fixtures |

## Verification status

The latest full automated application checks after onboarding passed **55 Python tests and 93 JavaScript tests**. These counts are a baseline for the code snapshot, not a substitute for hardware or provider acceptance.

| Area | Established status |
| --- | --- |
| Original Tier 1 face/head-pose detector | User confirmed real-camera operation |
| Phone detection extension | User confirmed real-camera operation |
| Tier 2 countdown, pause/resume, audio and summary | User confirmed manual operation before later tiers |
| USB Camera B | Implemented; real two-camera acceptance remains pending |
| Wi-Fi phone camera | Deferred and not implemented |
| Password account flow | Local/browser and hosted HTTPS verification completed |
| JWT ownership | Automated tests plus hosted cross-account read/write rejection completed |
| Google verifier and button | Implemented; signature/claims/linking tests and rendered button checked; real-account consent/login still needs acceptance |
| Account sessions and metrics | Hosted PostgreSQL save/read/retry, event order, server metrics and isolation checked |
| Legacy migration | Tests and hosted idempotent summary/pacing import checked, with no invented events |
| Onboarding and three recipients | Browser signup/edit/refresh/default prefill checked; hosted database persistence/ownership/fourth-address rejection checked |
| Email | One approved synthetic Brevo message showed provider delivery; multi-recipient behavior tested without sending three new real messages |
| Paired monitor permissions | Scope/revocation/replay/idle behavior tested; actual macOS permission and foreground-app behavior remain manual checks |
| Face/phone model assets | Actual CDN/WASM models and phone worker processed synthetic inputs under study CSP |
| Connected browser session | Controlled calibration/start/pause/resume/end/save/history and three-recipient prefill checked without camera/audio/email |
| Finder cold start and installed Chrome shell | Manual acceptance remains separate |

Test commands:

```sh
node --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

The local account fixture is `/tests/account-study-browser.html` on the account development server. Earlier legacy fixtures cover detector loading, session UI, and summary rendering on localhost:8000. Controlled inputs and mocks do not establish lighting accuracy, physical USB compatibility, audible tone quality, real Google consent, or OS permissions.

Earlier feedback reported usable tracking in the user's regular browser while an in-app browser could start the camera without showing usable pose readings. A definitive cause or general cross-browser resolution was not established in that feedback. Real acceptance should include the user's working browser and explicit compatibility checks rather than treating a synthetic model-load check as proof that every browser camera path works.

## Planning gaps and decisions

The following are current boundaries or decisions for a future plan, rather than features already present.

### Data durability and operations

- Resolve the free PostgreSQL expiration before November 24, 2026, including migration/backup/restore ownership.
- Decide whether reports, job statuses, monitor pairings and rate limits need shared durable infrastructure before scaling beyond one process.
- Design recovery for tab closure, unfinished sessions, expired auth during saving, and offline/failed completion uploads. There is no durable browser queue or server autosave stream today.
- Add history pagination/detail navigation if users need more than the latest 100 summaries or want to reopen old timelines in the UI.
- Evaluate cold-start loading/retry UX and a database-aware operational health check.

### Accounts and family privacy

- Decide password reset, email ownership verification, account deletion/export, token revocation/refresh, and account-profile editing.
- Review self-selected Parent roles, direct linking by email, student consent, unlinking, and what any future parent dashboard may expose. Current links do not authorize reading student sessions.
- Decide whether onboarding should support zero saved recipients while preserving explicit per-report opt-in.
- Decide how saved recipients should interact with later family-link changes. Current explicit lists win and are not silently expanded.
- Specify a multi-device/concurrent-session policy; current records are owner-scoped but multiple sessions can exist.

### Detector and session acceptance

- Finish real USB Camera B tests for held/beside-notes phones, both sources, removal, brief appearances, unplug/stall, and face-frame performance.
- Verify the integrated hosted experience with real Google sign-in, a real camera session, audio, account history, and optional paired macOS helper.
- Tune detector thresholds only from observed camera behavior. Document false positives/negatives and avoid interpreting head pose as comprehension.
- Review long-session timeline/report limits, client-side processing cost, and clock-skew sensitivity of hosted app evidence.
- Revisit fixed pattern-tip wording where it implies causes, brevity, or recovery not required by the rule.

### Product expansion

There is no native mobile app, teacher/school dashboard, admin console, scheduled reporting, push notifications, calendar integration, browser extension, tab-content inspection, screen recording, generative AI coach, or automated study planner in the current product. Their addition would need a separate scope and data/consent design.

Wi-Fi phone-camera upload is specifically deferred. It would change the current camera privacy boundary, require explicit authorization, and need a secure camera access/transport design. It should not be described as an already available Camera B mode.

The app's default remains supportive individual study. Any future use for grading, enforcement, parent surveillance, or high-stakes attention judgments would need a separate product and evidence review; secure account identity alone does not make the client-generated engagement record objective or tamper-proof.

## Constraints to preserve in future work

- Preserve plain HTML/CSS/JavaScript and the existing no-bundler frontend unless the user explicitly changes that constraint.
- Keep camera images, footage, calibration, and raw tracking data on the device. Accounts, confirmed events, report recipients and explicit emails are approved network data; they do not authorize camera uploads.
- Keep audio synthesized with Web Audio, and retain face/eye precedence, dwell thresholds, pause/unknown exclusions, and source-at-confirmation event semantics unless a separately reviewed change is intended.
- Recalibrate before every new session; never use hidden/background time to satisfy evidence dwell.
- Keep one shared JWT verifier and derive ownership from verified identity plus the database. A local profile ID, client UUID, role selector, or submitted user ID is not authorization.
- Never weaken password hashing, secret handling, HTTPS, production database requirements, or owner scoping to simplify a later feature.
- Keep existing legacy summaries and pacing without inventing full events. Preserve null/unknown values in any new analytics.
- Distinguish implemented code, automated verification, provider acceptance/delivery, and real user hardware/permission testing when planning milestones.

