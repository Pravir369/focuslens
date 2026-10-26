# FocusLens — Full Build Spec

Referenced by `AGENTS.md`. Read this entire file before writing any code.

## 1. What this app is

FocusLens is a browser-based study-focus tool. It uses the device's webcam and real-time face/head-pose tracking to detect whether the user is actively engaged with their study material (screen or physical notes) or has become distracted, during a timed study session. It gives in-session audio+visual nudges when distraction is sustained, and produces a session summary with a specific derived metric — **recovery speed** (how quickly the user returns to an engaged state after a distraction begins) — rather than a simple "% focused" score.

**Core design principles (do not deviate from these without good reason):**
- Camera processing stays client-side; camera footage/images and raw tracking data never leave the device. Library, WASM runtime, and model downloads are real network requests. Tier 7's user-approved exception adds a loopback Python API for explicit summary emails and optional macOS app-name-only monitoring. Only an opted-in report sends summary data externally. State these limits precisely; never imply zero network activity. Launch the local API server with `start.command` or `python3 server.py`.
- No build tooling. Plain HTML/CSS/JS. All dependencies loaded via CDN `<script>` tags. No npm, no bundler, no framework. This is a deliberate choice to minimize setup risk under a tight deadline.
- The CV/classification pipeline is the technical core of this project and must be correct before any other feature is polished. If forced to choose between a working detector and a polished UI, choose the working detector.
- Tone throughout the UI: neutral, non-judgmental, non-gamified-with-guilt. Never use language like "You failed to focus." Distraction is treated as normal and recoverable, not as a failure state.

## 2. Tech stack

- **HTML/CSS/JS only.** No React, no Vue, no bundler, no TypeScript.
- **Face/landmark detection:** MediaPipe Tasks Vision (`@mediapipe/tasks-vision`), loaded via CDN (jsdelivr or unpkg — use the ESM CDN build, e.g. `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest`). Use the `FaceLandmarker` task.
  - Config: `runningMode: "VIDEO"`, `outputFacialTransformationMatrixes: true` (needed for head pose), `outputFaceBlendshapes: true` (needed for eye-closure/drowsiness detection).
  - Model asset: use MediaPipe's hosted `face_landmarker.task` model file via its documented CDN URL (do not bundle the model locally).
- **Camera access:** `navigator.mediaDevices.getUserMedia({ video: true })`, piped into a hidden `<video>` element as the detection source. **Requires a secure context** — serve locally (e.g. `python3 -m http.server`) and access via `http://localhost:<port>`. Opening the HTML file directly via `file://` will not get camera permission in most browsers.
- **Phone detection (Tier 1 extension):** MediaPipe `ObjectDetector`, same pinned CDN package, with Google's hosted EfficientDet-Lite0 int8 v1 model and `cell phone` label. Run VIDEO inference in a module Web Worker, at most four samples per second and one request in flight, including bitmap creation. Close transferred images after processing; terminate the worker on stop/failure. Start with confidence ≥0.55 and results fresh for at most 750ms, both named constants requiring real-camera tuning. No phone model/worker is required in studying-with-phone mode.
- **Audio cues:** Web Audio API, synthesized tones via `OscillatorNode` — **do not use external audio files.** This keeps the project fully self-contained with zero asset management. See Section 6 for exact tone specs.
- **Persistence:** `localStorage` only, for optional cross-session history. No database, no accounts, no login.
- **No external CSS framework required** — plain CSS is fine. Keep the visual design clean and minimal; this is not the part being judged on complexity.

## 3. Architecture overview

Single-page app, five main views shown/hidden via simple JS state (no router needed):

1. **Start screen**
2. **Calibration screen**
3. **Session setup screen**
4. **Live session screen**
5. **Summary screen**

(Optional 6th view — History — see Priority Tier 3.)

### Core data model

```js
// One record per state transition during a session
{
  type: "engaged" | "distracted" | "drowsy" | "away", // "away" = face not detected
  start: <timestamp ms>,
  end: <timestamp ms>,   // null while ongoing
  duration: <ms>         // filled in when the event closes
  // Tier 4: phone-triggered distracted events may additionally have
  // triggerSource: "cameraA" | "cameraB" | "window" (source at confirmation).
}
```

A session is just an array of these events plus metadata: `{ goalMinutes, goalEngagementPct, startTime, endTime, events: [...] }`.

Tier 2 metadata also includes `phonePolicy`, `activeSegments` (`start`, `end`, `eventStartIndex`, `eventEndIndex`), and `unclassifiedPeriods` (`start`, `end`). Events retain their original four-state schema. Segments separate pauses from observation time; unclassified periods cover initial waiting and unusable required readings. Exclude unclassified portions from engagement and longest-distraction duration, and exclude any distracted event spanning missing observations from recovery averages. Show pauses and unclassified periods separately on the timeline.

### State machine (the heart of the app)

At any moment, the user is in exactly one of four states, derived every frame from MediaPipe's output:

- **`engaged`** — head pose falls within the calibrated "screen zone" or "notes zone" (see Section 5), with fresh phone-absent evidence required in phone-free mode.
- **`distracted`** — face is detected, but head pose falls outside both calibrated zones, or a fresh phone detection overrides the zone in phone-free mode.
- **`drowsy`** — face is detected, eyes have been closed (via blendshape score) continuously for >1 second.
- **`away`** — no face detected, with fresh Camera A person-absent evidence in the presence-enabled path described in Section 5.2.2. The legacy face-only path uses missing landmarks alone. This is treated as a legitimate break, NOT as distraction. Do not count it against engagement %, do not fire nudges during it.

**Critical: do not act on raw per-frame state.** Raw MediaPipe output is noisy (a single blink, a quick glance while writing, momentary tracking loss). All state transitions must go through the debounce/hysteresis logic in Section 5 before anything in the UI or event log reacts.

## 4. Calibration (Screen: Calibration)

Purpose: establish the user's personal head-pose range for "on task," since desk setup, camera angle, and posture differ per person. This must run before every session (keep it short — under 20 seconds total).

**Three-step guided sequence**, each step shows on-screen instruction text and a visible countdown:

1. **"Look at your screen"** — 5 seconds. Capture head-pose (yaw/pitch, see Section 5) readings throughout; average them to get the **screen-zone center**.
2. **"Look down at your notes, like you're writing"** — 5 seconds. Same capture; produces the **notes-zone center**.
3. **"Now glance to the side, like checking your phone"** — 3 seconds. Capture this too — it's used only to sanity-check that the screen/notes zones are clearly distinguishable from an off-task glance (not stored as a target zone itself).

After capture: apply independent rectangular tolerance bounds around the screen-zone and notes-zone centers (start with ±15° yaw / ±12° pitch, and expose these as named constants near the top of the configuration file so they're easy to tune after real testing — real testing will almost certainly require adjusting these numbers).

Store calibration result in memory (not localStorage — recalibrate each session, since desk setup may change day to day).

Each calibration step requires valid face/pose readings in at least 90% of processed camera frames. Average pose only over valid frames; brief missed detections are allowed. Below 90%, show an inline error explaining the detection rate and allow restarting calibration. Do not allow proceeding without successful calibration. Study zones use independent yaw/pitch bounds (rectangles), initially ±15° yaw and ±12° pitch. The average side-glance pose must fall outside both zones; otherwise explain the overlap and offer recalibration.

## 5. The classification pipeline (core technical logic)

### 5.1 Extracting head pose

MediaPipe's `facialTransformationMatrixes` output gives a 4x4 transformation matrix per detected face per frame. Extract yaw, pitch, and roll Euler angles from the rotation component of this matrix (standard rotation-matrix-to-Euler-angle conversion — implement this as a small pure function, e.g. `matrixToEulerAngles(matrix) -> {yaw, pitch, roll}`).

Document the matrix storage and axis/Euler convention explicitly in code. Verify signs and magnitudes empirically with deliberate head movements in the debug view.

### 5.2 Zone check (per frame, raw)

```
if no face detected this frame:
    rawState = "away"
else if required face pose/blendshape readings are unusable:
    rawState = unknown
else if eyeClosed (avg of eyeBlinkLeft/eyeBlinkRight blendshape scores > threshold, e.g. 0.6):
    rawState = "eyes_closed"   // only becomes "drowsy" after sustained duration — see 5.3
else if calibration is incomplete:
    rawState = unknown
else if phone-free and phone evidence is missing or stale:
    rawState = unknown
else if phone-free and a fresh phone detection is present:
    rawState = "distracted"
else if (yaw, pitch) within screen-zone tolerance OR within notes-zone tolerance:
    rawState = "engaged"
else:
    rawState = "distracted"
```

### 5.2.1 Phone policy and detection

Choose a policy before calibration and lock it while the camera/test/session is active. Default **Phone-free**: a fresh positive phone result produces raw `distracted`, even inside a study zone; a phone lying unused in view also counts. **Studying with phone** ignores phone evidence and uses the original face classifier without loading the phone model. Phones outside the camera view cannot be detected.

Precedence: no face → `away`; unusable face readings → unknown; closed eyes → `eyes_closed`; successful calibration required; then in phone-free mode evaluate phone evidence before head pose. Missing/stale phone results mean unknown, not phone absence. Unknown resets pending dwell. Fresh phone absence plus an engaged head pose is required to return to `engaged`. Apply the existing 3-second distraction debounce exactly once, with no extra phone dwell. Changing the cause of raw `distracted` from phone to head pose (or vice versa) does not reset the candidate. Preserve all four states and the existing event format; show the raw reading reason separately in diagnostics.

Show phone detection status, confidence, result age, and correctly aligned boxes on the mirrored preview, with readable labels. Distinguish library download, runtime/WASM initialization, face-model download, phone-model download, and worker/inference errors. Offer retry; never silently bypass phone-free detection. Hide/stall invalidation clears phone evidence and rejects late results from before the interruption.

### 5.2.2 Looking away versus leaving the chair

The user reported that turning their head caused face landmarks to disappear and incorrectly became `away`. In Phone-free mode, the existing EfficientDet worker now reads both `person` and `cell phone` from the same inference. Camera B never establishes student presence. No extra worker, camera image storage, or camera uploads are added.

When face landmarks are missing in this presence-enabled path, require calibration, then inspect Camera A's fresh person result: present → raw `distracted`; absent → raw `away`; missing/stale → unknown. Apply the existing three-second distraction and one-second away dwell exactly once. A transition from an off-zone face pose to missing landmarks with person presence remains one continuous distracted candidate. A detected face keeps the existing pose/eyes/phone precedence. Event fields, metrics, recovery exclusions and audio rules remain unchanged.

Person confidence starts at 0.45 and freshness at 750ms, with separate named constants. Phone confidence remains 0.55. Diagnostics show person presence, confidence and result age. Include the head and upper body in Camera A's view and manually verify head turns and leaving the view; a model-loading check is not a camera-accuracy check. Person detection is a presence estimate, not identity or gaze recognition; another visible person can affect it.

Studying with phone remains on the existing face-only path for now. Enabling the object model there requires the user's pending confirmation because the earlier policy explicitly excluded that dependency.

### 5.3 Hysteresis / debounce (this is what makes the detector correct, not noisy — do not skip this)

Maintain a `currentConfirmedState` (what the UI/log actually reflects) separate from the raw per-frame reads. Apply **different thresholds for entering vs. exiting a state**:

- To transition **into `distracted`**: rawState must read "distracted" continuously for **3 seconds**.
- To transition **back into `engaged`** from distracted: rawState must read "engaged" continuously for **1 second**.
- To transition **into `drowsy`**: eyes must read closed continuously for **1 second**.
- To transition **into `away`**: no face detected continuously for **1 second** (brief tracking dropout shouldn't instantly register as "away").
- Exiting `away` or `drowsy` back to engaged/distracted: evaluate normally against the rules above once a face is detected again.

Implement this with a simple timer/counter per candidate state — e.g., track `candidateState` and `candidateStateSince`; only commit `currentConfirmedState = candidateState` once the required dwell time has elapsed, and reset the candidate timer any time the raw read changes.

Before the first candidate qualifies, display "Waiting for classification" and keep the event log empty. Timestamps use confirmation time, never candidate onset. A hidden/suspended tab or interruption in frame processing resets candidate dwell; unobserved time is not evidence.

**Every confirmed state transition is what gets logged as an event** (per the data model in Section 3) — not raw per-frame reads.

### 5.4 Recovery speed (the key derived metric)

Only confirmed `distracted → engaged` transitions count as recoveries. Recovery speed is that distracted event’s duration: `(end timestamp) - (start timestamp)`. Distractions ending in `away` or `drowsy`, or ongoing when a session ends, stay in the timeline/event count but are excluded from the recovery-speed average. The immediately following event identifies the transition destination; no extra event field is needed. Reporting:

- Track average recovery speed across qualifying recoveries only.
- On the Summary screen, show this as a headline stat, not buried — it's the most meaningful number in the app.
- If localStorage history is implemented (Tier 3), show whether average recovery speed is improving across sessions over time.

## 6. In-session nudges (audio + visual, two-stage)

Triggered off the **confirmed** `distracted` state (never off raw/unconfirmed reads).

**Stage 1 — subtle, at 15 seconds into a confirmed `distracted` state:**
- Visual: the state indicator is already amber from the moment distraction is confirmed. The 15-second threshold gates the audio cue, not the color.
- Audio: a single short, quiet synthesized tone. Use `OscillatorNode` with `type: "sine"`, frequency around 440Hz, very short duration (~150ms), low gain (~0.08). This should be barely noticeable — a gentle cue, not an alert.

**Stage 2 — clear nudge, at 45 seconds into a confirmed `distracted` state (i.e. 30 seconds after Stage 1, assuming distraction is still ongoing):**
- Visual: a small non-blocking banner/toast appears: "Still here? Tap to resume focus." with a single tap target.
- Audio: a slightly more noticeable two-tone chime — two short sine oscillator tones in quick succession (e.g. 440Hz then 554Hz, ~150ms each), low-to-moderate gain (~0.15). Still gentle — this is a nudge, not an alarm. Avoid anything harsh or buzzer-like.
- Tapping the banner doesn't force any particular action — it just dismisses the banner. The actual return to focus is detected naturally by the classifier when the user's head pose returns to an engaged zone.

**Debounce the nudges themselves:** once Stage 2 has fired for a given distraction event, do not fire it again for the same continuous event (no repeated nagging every 30 seconds indefinitely). It's fine for Stage 1 + Stage 2 to fire again on the *next* distraction event later in the session.

**Never fire nudges during `away` or `drowsy` states** — only during confirmed `distracted`.

## 7. Page-by-page UI spec

### Screen 1 — Start

- App name/short one-line description.
- State the privacy model precisely: "Your camera footage and images never leave this device. Nothing from your camera is uploaded." Explain separately that the tracking library and model download over the network.
- Single button: **"Begin"** → triggers camera permission request, then moves to Calibration.
- If camera permission is denied, show a clear inline message explaining the app requires camera access to function, with a way to retry.

### Screen 2 — Calibration

- Large, clear instruction text per step (see Section 4): "Look at your screen" → "Look down at your notes" → "Glance to the side."
- Visible countdown timer per step.
- Small live video preview (helps the user confirm they're in frame — this is also useful for your own debugging).
- On completion: automatically advance to Session Setup. On failure (no face detected): inline error + retry button, stay on this screen.

### Screen 3 — Session Setup

- **Session length:** simple dropdown or button group — options like 15 / 25 / 45 minutes, plus a custom numeric input.
- **Engagement goal:** numeric input or slider, default 80%, labeled clearly (e.g. "Target: stay engaged at least ___% of the session").
- Button: **"Start Session"** → begins the timer and moves to Live Session.

### Screen 4 — Live Session

- **Countdown timer** showing time remaining in the session.
- **State indicator** — a clear, large color-coded element reflecting `currentConfirmedState` in real time: green = engaged, amber = distracted immediately upon confirmation, blue/gray = drowsy, neutral gray = away. The 15s/45s timers gate audio escalation; the indicator color always reflects the current confirmed state. The Stage 2 banner still appears at 45s.
- **Running engaged %** for the session so far (simple running calculation from the event log: total engaged time / total elapsed time excluding `away` periods).
- Stage 2 nudge banner (per Section 6) appears here when triggered, non-blocking.
- A **"Pause / End Session early"** control — sessions shouldn't trap the user; always allow ending early, and still generate a summary from whatever data was collected.
- Tier 2 pause behavior: auto-pause on hidden tab, camera loss, or tracking failure. Freeze countdown, scoring, and nudges; require manual resume. Close the current event on pause, preserve calibration within the same session, and reset candidates/phone evidence on resume. Track active-segment boundaries in session metadata so pauses cannot appear as recoveries. Exclude unclassified time as well as away and paused periods from engagement scoring; show waiting text when no classified denominator exists.
- When the timer reaches zero: automatically transition to Summary.

### Screen 5 — Summary

- **Headline stats, in this order of visual priority:**
  1. Average recovery speed this session (the signature metric — make this the most prominent number on the screen)
  2. Overall engaged % vs. the goal set in Session Setup → clear pass/near/miss framing (e.g. "You hit your goal" / "Close — X% short of your goal" / "Below goal" — neutral language, no shaming tone)
  3. Number of distraction events
  4. Longest single distraction streak
- **Session timeline visualization:** a horizontal bar, full session width, color-segmented by state over time using the event log (green/amber/blue/gray segments matching the Live Session indicator colors). This is the explainability element — a judge or user should be able to look at this bar and see exactly when lapses happened, not just an aggregate number.
- Button: **"New Session"** → returns to Calibration, then Session Setup. Fresh calibration is required before every session; never offer a reuse shortcut.

Summary edge cases: zero distraction events → "No distractions this session." A result within 10 percentage points below the engagement goal is "near"; anything further below is "below goal." At or above the goal is a pass.

If distractions occurred but none ended in a qualifying recovery, show "No recoveries recorded." If there is no classified denominator, show "No classified time" and do not compare a fabricated percentage with the goal. Stop camera/model/worker resources on summary. Resume after a pause requires a manual click and fresh camera/phone evidence; reconnecting alone never resumes. Audio failure leaves visual reminders available with an Enable sound retry. Unknown readings suppress cues; delayed UI ticks emit only the highest outstanding stage to avoid stacked cues.

### Screen 6 — History (Tier 3 / optional, see below)

- Simple list or line chart (plain `<canvas>` or SVG — no charting library needed for this) of average recovery speed per past session, pulled from `localStorage`, most recent last, to show trend over time.
- Not required for core functionality — only build this if Tiers 1–2 are solid with time to spare.

## 8. Priority tiers — build in this order, do not reorder

**Tier 1 — must be correct before anything else is touched:**
1. Camera capture + MediaPipe FaceLandmarker streaming live landmark/transformation-matrix output (just get numbers flowing — a debug view printing yaw/pitch/roll to the screen is a reasonable first milestone)
2. Calibration flow, storing zone centers + tolerances
3. The zone-check + hysteresis/debounce state machine (Section 5) — this is the single most important piece of the entire project. Test it extensively against real use (sit at your desk, actually look away on purpose, actually look at notes, confirm the states and timings feel right) before moving on. Expect the tolerance constants from Section 4 to need real adjustment.
4. Event logging matching the data model in Section 3

Required Tier 1 extension before Tier 2: phone detection with the two policies described in Section 5.2.1. Stop for real-camera feedback on this extension before writing Tier 2 code, even though the original face-only detector has already been tested successfully. The worker/model loading check is not a substitute for camera verification.

Verification status: the user confirmed successful real-camera testing of both the original detector and phone extension, then confirmed Tier 2's timer, pause/resume, 15s/45s sound reminders, and summary worked. Tier 3 may proceed. Tier 3 is implemented and ready for manual history/setup verification.

**Tier 2 — build once Tier 1 is solid:**
5. Live Session screen with real-time state indicator + running engaged %
6. Two-stage audio+visual nudges (Section 6)
7. Summary screen with recovery-speed stat, pass/near/miss, and the timeline visualization

**Tier 3 — only if time remains:**
8. Session Setup goal/length UI polish (a hardcoded fixed-length session with no goal-setting is an acceptable fallback if time is short)
9. `localStorage` persistence + History screen
10. Any visual/animation polish beyond clean and functional

Tier 3 implementation choices: history is opt-in, off by default, and saves at session completion/early ending. Store only whitelisted summary statistics and session settings in `localStorage`, with a versioned format and a 100-summary limit (oldest first). Never persist calibration, images, poses, event timelines, or interrupted unfinished sessions. Disabling saving preserves prior summaries; Clear history deletes them and disables saving. Browser-storage errors must not interrupt sessions. Recovery-chart gaps represent sessions without qualifying recoveries, not zero-duration recoveries. Compare the first and latest qualifying averages descriptively; this is not a statistical claim. History belongs to the browser/site origin and is not synced or uploaded.

**Tier 4 — dual-camera phone detection:**
11. Implement the optional second USB camera described in `TIER4_DUAL_CAMERA.md` (full supplied specification). Pick a separate video input after Camera A permission, then use exact-device getUserMedia with no audio. Keep the face/calibration/state-machine pipeline on A. B runs phone detection only, through the same worker and ObjectDetector instance as A, with one request in flight globally and a combined maximum of four samples per second. Use VIDEO-mode `detectForVideo`, not IMAGE-mode `detect`, with a global increasing inference clock and separate per-source capture timestamps.
12. Fresh phone evidence from either view can produce raw distraction in phone-free mode; face/eye/calibration precedence and dwell times stay unchanged. A wins if both views are positive at confirmation. Optional `triggerSource` records that confirmation source only; changing cause does not split events or reset dwell. History remains summary-only and does not persist sources/events/device IDs.
13. B is optional positive evidence: missing/stalled/stale/failed B is ignored, never treated as proof of absence and never a requirement for engagement. A still requires its own fresh phone-absent reading to establish engagement. B capture/inference failures release its request and drop its evidence; they must not stop A's worker or pause the session. Reset both sources on interruption/resume; reject late results from a replaced or disconnected B. Never use a still-displayed frozen video frame as fresh evidence. Show the B status, confidence, result age, unmirrored preview/boxes, and camera source in live/summary diagnostics.
14. **Stop for a real second-camera test before the Wi-Fi option.** The USB implementation requires confirmation of a phone below Camera A's view, brief appearances, phone removal, B unplug/stall/permission failure, both policies, timing, and continued face tracking without repeated interruption resets.

Wi-Fi image polling in the supplied addition is deferred, not implemented or advertised as available. Its proposed uploads/backend conflict with this document's existing client-only privacy guarantee and AGENTS.md's hard constraint; revisit explicitly only after USB verification and user authorization for the changed privacy model. In addition, phone-browser getUserMedia requires HTTPS (a laptop's ordinary LAN HTTP address is not the phone's localhost). A secure deployment plan is required before implementing that later option.

**Tier 5 — summary insights, presentation only:**
15. First implement the pattern tip from `TIER5_INSIGHTS_UI.md` Section 3, using existing confirmed events. Count phone-triggered distracted events (cameraA or cameraB), source-free distracted events (look-away), and drowsy events. Select the largest count with tie order phone > drowsy > look-away; use the supplied four fixed messages. Place the tip directly below the four headline stats and above the timeline, without a separate card.
16. Next mark existing distracted timeline segments whose recorded source is cameraA or cameraB with a dark amber inset border and a legend key. Keep segment widths, ordering, timing, and source details unchanged. Do not mark away, drowsy, paused, or unclassified portions of an event.
17. Last format the same recovery, engagement/goal, distraction-count, and longest-distraction numbers as sentences. Keep the existing pass/near/below goal feedback and no-distraction/no-recovery/no-classified-time messages. Display duration values in seconds without changing their numeric meaning or precision; call the longest metric a distraction rather than the separate `away` state.

The three Tier 5 steps are independently shippable and implemented in that order. No camera, calibration, classifier, hysteresis, event logging, session metrics, history, or audio code changes are permitted for this tier. `js/insights.js` and the summary renderer only read existing records. The source document's fixed look-away wording mentions brevity and recovery even though its selection rule checks counts only; preserve the supplied copy without inferring extra events or recoveries. Tier 4's USB hardware verification remains pending independently of these summary display changes.

**Tier 7 — remaining work, authoritative source `TIER7_FINAL.md`:**
18. A random browser-local profile ID is metadata, not authentication. Use `profileId` for local pacing/history records and every report/session/window payload. Existing legacy summary records migrate to the current local profile. Storage failure leaves sessions usable with an ephemeral profile.
19. Store each ended session's `{ profileId, date, timeToFirstDistraction }` locally, in milliseconds at first distraction confirmation; null means no distraction, excluded from suggestions. Select the upper middle median, convert to minutes, round to five, clamp 5–45, and preselect in Setup with editable explanation. No data retains the existing default. Pacing storage is separate from opt-in summary history and can be cleared independently.
20. Explicitly submit one or two per-session email addresses from Summary. The loopback API queues asynchronous TLS SMTP delivery, reports status/failure inline, and uses ignored local `.env` credentials. Reuse the same headline/tip/timeline formatting. No automatic emails, camera/raw tracking payloads, recipient subscriptions, or persisted report contents.
21. Optional macOS monitoring polls app names only every 2.5 seconds while an enabled session has a fresh active lease. Window titles are always empty; no screenshots or tab access. Exact normalized allow-list matches are on-task; blocked/unknown apps are off-task. An empty list allows nothing. An allow-listed browser permits all its tabs. Camera A face/eye/calibration precedence remains; phone A/B wins simultaneous positive sources. Fresh app mismatch ORs into raw distracted via a separate adapter and the unchanged 3-second debounce. Missing/stale/failing monitor is no signal; pause/resume rejects old readings. Tag confirmation source `window`, add its own pattern tip and purple timeline marker, and retain all four event types, dwell times, metrics, and reminder timing. Keep FocusLens visible alongside another app; hiding still auto-pauses.
22. `start.command` launches a ready-checked loopback server and optional companion, opens localhost, prevents duplicate launchers, and cleans up its child process groups on exit. It never kills an unrelated server. Manifest and 192/512 PNG icons support Chrome standalone installation; the local server and initial network model downloads are still required, with no offline promise. Section 5's permissions and true Finder cold start are manual user checks.

These Tier 7 additions are implemented. The backend/email exception and additive UI integration were explicitly approved by the user. No prior camera, classifier, calibration, tracking, phone-inference, scoring, or audio implementation was changed. The new signal adapter and `window` source whitelist are the only classification/log integration additions.

**Hard rule:** if Tier 1 isn't solid, do not start Tier 2. A correct detector with a plain UI is a far stronger result than a polished UI sitting on a broken or noisy detector.

## 9. Known risks to flag while building (not blockers, just things to expect)

- Real-time CV debugging is generally fiddlier than backend logic — budget more time for Tier 1, item 3 than it looks like it should take.
- The tolerance constants in calibration (Section 4) are starting guesses, not final values — plan to tune them against real testing on the actual device/camera being used for the demo.
- Lighting conditions affect face detection reliability — test in the actual room/lighting the demo will be recorded in, not just wherever development happens to happen.
- `getUserMedia` requires a secure context. Serve via `localhost`, never open the HTML file directly from disk.
