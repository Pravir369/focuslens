# FocusLens

## Phase 2 account-connected study app

The new app is at **https://focuslens-accounts.onrender.com/**. Sign in, then choose **Open study app**. `/study` uses the existing camera/classifier/session UI with account adapters: confirmed events and timing boundaries save when a session ends, and the server calculates the summary and pacing suggestion. Camera images, calibration, raw head pose, screenshots and browser tabs are never uploaded. The older `start.command` / `server.py` app on port 8000 remains a separate **Phase 1 local app**; it does not gain account authorization by signing into the new service.

New password and Google accounts complete two onboarding steps: choose a default duration, engagement goal and phone policy; then save one to three report email addresses (Gmail or another provider). These preferences live in an owner-scoped `user_settings` row, behind the same JWT verifier as other account data. `/study` sends unfinished accounts back to onboarding. Existing accounts keep access after the migration and can use **Edit study and report settings**; accounts without saved recipients retain their previous self/parent defaults.

Saved phone policy and engagement goal prefill the study UI. Saved duration is the starting length when no personalized pacing suggestion exists; all remain editable before a session. All three saved recipients prefill Summary, where they can be changed for that report only. Settings changes never send email. Sending still requires **Send Report** explicitly; each recipient receives a separate message. Saved recipients take precedence over family-link defaults until edited again. The older local-only Phase 1 report form retains its two-address behavior.

Implemented in the specification's order: database migrations; bcrypt email/password signup and login; one shared JWT verifier; verified Google sign-in; owner-scoped session, family, report and monitor routes; legacy summary/pacing import; hosted integration. Minimal integration hooks in the old app connect these adapters without changing camera, classifier, calibration, event logging, scoring, audio or detector modules.

### Hosting and configuration

Private source: `https://github.com/Pravir369/focuslens`. `render.yaml` creates one free web service and managed PostgreSQL in Oregon, with private database access. Render injects the database URL and generates the JWT signing secret; secrets, environments, databases and screenshots are ignored by Git. Migrations run before Gunicorn starts. One worker with four threads is intentional: rate limits, report jobs, app-monitor leases and pairing devices are held in process memory. Those short-lived items disappear on restart; saved users/events/history remain in PostgreSQL. Automatic commit-triggered deployments are disabled.

**The free database expires November 24, 2026.** Arrange durable hosting/backups before then; this is a testing service, not permanent storage. Free web services also sleep when idle. A cold request can take roughly a minute; retry after it wakes. Hosted SMTP is blocked, so reports use Brevo's HTTPS transactional-email API. The sender `focuslens998@gmail.com` is verified. Gmail-domain sender authentication/deliverability may differ from a properly authenticated custom domain. No SMTP password is uploaded to Render.

The ignored environment holds `JWT_SECRET_KEY`, `DATABASE_URL` (production), `GOOGLE_CLIENT_ID`, and email configuration. For Brevo use `REPORT_TRANSPORT=brevo`, `BREVO_API_KEY`, and `REPORT_FROM_EMAIL`. The Brevo key is restricted to transactional email and expires October 26, 2027, or after 90 days unused. Provider acceptance is displayed as **accepted**, not proof of inbox delivery; check spam and the provider's delivery logs before retrying a failed/uncertain send. Recipients receive separate messages. Sending is always an explicit action after a saved session; family links never send automatically.

Google Cloud project `focuslens-512800`, client **FocusLens Web**, allows the hosted origin and `http://localhost`, `http://localhost:8000`, `http://localhost:8001`. It uses Google's GIS callback flow, with no redirect URLs or client secret. External/Testing mode currently includes `focuslens998@gmail.com` as a test user. To allow additional testers, add them in Google Cloud. Real Google consent/login remains a user acceptance check.

### Local account app

Install Python 3.10+ and run:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m flask --app backend:create_app db upgrade
.venv/bin/python accounts_server.py
```

Open **http://localhost:8001/**, sign in, and choose **Open study app**. Add a randomly generated signing secret to ignored `.env` before first startup (at least 32 bytes; `secrets.token_hex(48)` is suitable). Local SQLite lives in ignored `.instance/focuslens.sqlite3`; production fails closed without HTTPS and managed PostgreSQL. Do not serve this app with a static server. Existing local SMTP credentials can still be used by selecting `REPORT_TRANSPORT=smtp` locally.

### Accounts, migration and desktop helper

Passwords use salted bcrypt (cost 12), require eight characters, and reject inputs over 72 UTF-8 bytes explicitly. No password/hash/token/connection secret is logged. All data identity comes from the verified signed JWT and current database user, never a client-submitted ID. Sessions are owner-scoped on reads and writes; completed records are immutable, with exact retry support. Google signature/audience/issuer/expiry/email verification and a cookie-bound nonce precede account lookup. Linking Google to an existing password account additionally requires that account's password. Tokens use Authorization headers, sessionStorage with memory fallback, and seven-day expiry. Logout clears local access; global token revocation and password reset are outside this specification.

Legacy data at the same browser origin is imported after successful authentication and cleared only after complete acknowledgement, if the original snapshot has not changed. Old summaries remain explicitly marked **Imported summary**, with unknowns preserved and no invented events. Pacing imports are separate from summary history. For the old localhost:8000 app, choose **Export old history for account import**, then import that JSON from the signed-in hosted account page. Your export file remains intact. A localhost origin's storage is not readable by the hosted site.

A parent signs in with a Parent account and links a Student by the student's registered email. As requested in the spec, this is a direct link with no invitation/acceptance flow. Linking does not expose the student's history. Without saved recipient settings, the student's report form defaults to their own address plus a linked parent's stored address. Saved recipient settings take precedence; recipients can still be changed explicitly for a report.

Optional macOS app monitoring uses the account page's downloadable helper and a one-use, two-minute pairing code. Unzip **FocusLens-monitor.zip**, run `connect-monitor.command`, and paste the pairing code into its hidden prompt. Python 3 and macOS Automation permission are required. The helper holds a restricted four-hour token only in memory and can only fetch monitor configuration and post app-name evidence. It cannot read session history, family links, reports or account identity. It reads app names only during an active session with monitoring enabled; no window titles, tabs or screenshots. App names travel to the configured account service via HTTPS. Revoking helpers or signing out from the study app invalidates pairings. Restarting the server or helper requires pairing again. Missing/stale helper evidence is ignored without interrupting camera tracking.

### Verification and remaining manual acceptance

Automated checks cover owned CRUD and cross-user rejection, server-calculated scoring/recovery exclusions, exact retries, malformed/client-identity rejection, imports without invented events, parent defaults, monitor scope/revocation/stale evidence, and mocked HTTPS email failures. Existing detector/session checks remain intact. The local browser fixture at **http://localhost:8001/tests/account-study-browser.html** uses a disposable synthetic account in that server's database: actual auth, controlled calibration/session/pause/resume/end, persisted events and metric parity. Its separate model check loads the actual face model and phone worker and processes a blank synthetic canvas under the study CSP. It does not use a camera, audio, OS monitoring or email. Fixture routes are unavailable in production.

Before calling all real-world features verified: sign in with your real Google test account; complete a camera session through the hosted app; refresh and confirm saved history; send an opted-in report and check the inbox; pair the helper and approve macOS permissions yourself. Earlier camera/audio testing remains useful but cannot establish the new hosted permission/sign-in flows. Synthetic/model checks do not establish physical-camera accuracy, audible cues, OS permission behavior or inbox delivery.

Run all automated checks:

```sh
node --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

## Phase 1 study app

A browser study companion using local face/head-pose, optional phone detection, and optional macOS app-name monitoring. Plain HTML/CSS/JavaScript plus a Python standard-library local server; no build step, framework, or package installation.

**Status:** Tier 1 face/phone detection and Tier 2 sessions/audio received successful real-camera feedback. Tier 3 adds opt-in local history, a recovery trend, and session setup polish. Tier 4's optional USB desk-camera path is implemented and awaiting a real two-camera test. Tier 5 adds summary-only pattern feedback, phone timeline markers, and sentence-style headline stats. Wi-Fi phone-camera uploads remain deferred until the USB gate passes and the privacy/secure-context conflicts are resolved.

Tier 7 implements personalized pacing, explicit summary emails, optional app-name monitoring, double-click startup, and a standalone-app manifest, in that order. `TIER7_FINAL.md` is authoritative over earlier Tier 6/7 documents. The user approved the local backend/email exception and additive UI integration. Real SMTP delivery, macOS permissions, Finder cold start, and Chrome installation remain manual acceptance checks.

Camera footage, images, and raw tracking data stay on this device. MediaPipe Tasks Vision 0.10.32, its WASM runtimes, and Google's versioned face/phone models download over the network. Camera images are never saved. Detailed events and calibration exist in browser memory. Optional history saves summary statistics locally; it is off by default. Pacing stores first-distraction timings separately. Only clicking Send Report sends the displayed summary/tip/text timeline to the entered email addresses through the configured SMTP provider. Optional monitoring sends only the latest app name to the loopback server, never screenshots, window titles, or tab details. No microphone, camera uploads, accounts, analytics, or external audio files are used.

## Open locally

On macOS, double-click **start.command** in Finder. It is already executable. Python 3.10+ must be installed. It starts the local server and the optional app-monitor companion, waits for server readiness, then opens the browser. Close its Terminal window or press Ctrl+C to stop processes started by that launcher. A second launch opens the running app instead of starting duplicates. A pre-existing FocusLens server is reused and remains owned by its original launcher. If another service owns port 8000, close that service yourself; FocusLens will not kill it.

For server-only development, from this project directory:

```sh
python3 server.py
```

Open **http://localhost:8000/** in your working browser. Do not open the HTML file through `file://`. If the browser says the site cannot be reached, restart the launcher. Internet access is needed for dependency/model downloads. The server binds only to 127.0.0.1, blocks configuration/executable files and directory listings, and accepts only local same-origin API requests. A plain static server can show the camera UI but cannot provide the new APIs. `profileId` is ownership metadata, **not authentication**; this is not suitable for public hosting.

## Tier 7 setup and manual acceptance

1. **Pacing:** complete a session with a confirmed distraction, then begin a fresh calibrated session. Setup should suggest an editable 5–45 minute block, rounded to five minutes, using the upper-middle median of past first-distraction times. No-distraction sessions contribute no data point. The timestamp is confirmation time minus session start (milliseconds, including pauses), not candidate onset. Fresh profiles default to 25 minutes. Clear pacing history is separate from Clear summary history. A random local `focuslens_profile_id` is reused; clearing site data creates a new identity, not an account.
2. **Email configuration:** copy `.env.example` to `.env` and fill in your sending account and an SMTP **app password**, never its normal login password. Keep `.env` local/ignored and restart the server after edits. Gmail defaults are SSL port 465; STARTTLS port 587 is also supported. Never paste credentials into the browser or commit them. End a session, type one or two recipients, then click **Send Report**. Check delivery and matching stats/tip/timeline. Sending stays asynchronous; test an invalid app password to confirm a useful failure while Summary remains usable. Recipients are per-send, not subscriptions; the server retains only short-lived delivery status, not report contents or address lists. SMTP acceptance does not guarantee inbox delivery. No real email has been sent by the automated checks.
3. **App monitoring:** use `start.command`, or run `python3 window_monitor.py` alongside the server. In Setup, enable **Use my study-app list this session** and enter actual macOS app names, separated by commas or newlines (e.g. `Google Chrome, Notion, Preview`). The choice/list are locked during that session. Allow-list matches win; blocked and unknown names are off-task. An empty list allows no apps. An allowed browser permits **all** its tabs; this version cannot distinguish a study tab from YouTube. The companion reads nothing while monitoring is off or paused. A missing/stale/failed companion is ignored and cannot stop camera tracking.
4. **Permissions and real app test (user-run, Section 5):** allow your browser under System Settings → Privacy & Security → Camera. When enabling monitoring, permit the launcher/Terminal to control System Events under Automation; consult Accessibility if macOS requests it. This version reads the **app name only**, not the active-window title. Keep FocusLens visible beside another app; hiding it still auto-pauses. With an engaged head pose, switch to a non-allowed app, wait for its reading plus the unchanged 3-second dwell, then verify Distracted / Active app. Return to an allowed app and hold an engaged pose for one second. Verify the app-specific summary tip/purple timeline marker, both phone policies, face-loss/closed-eye precedence, and 15s/45s reminders. Pause/resume and stop the companion: stale or pre-pause readings must not remain evidence.
5. **Standalone app:** while the server is running, open localhost in Chrome and choose **Install FocusLens** from Chrome's install control/menu. The manifest supplies standalone display and 192/512 PNG icons. Keep the launcher running when opening the installed app; this is a local app shell, not an offline bundle. Network access is still needed for model downloads. No service worker caches API responses or camera data.
6. **True cold start (user-run, Section 5):** quit the browser and stop the running launcher/server, then double-click `start.command` from Finder. Verify the page opens, camera/model loading works, the optional monitor gets real app names, and a session completes. Automated startup checks use isolated ports and disabled real monitoring; they do not replace this test.

## Session flow

1. **Start:** choose Phone-free (default) or Studying with phone, then Begin and allow camera access. The policy is locked while the camera/session is active. Loading errors identify the library, runtime, model, or worker stage and offer a retry.
2. **Calibration:** click Start calibration and follow screen (5s), notes (5s), and side-glance (3s) prompts. Each step needs at least 90% valid face/pose readings. Only valid frames enter the pose average. The side-glance center must fall outside both rectangular study zones. A tracking interruption fails calibration and offers retry.
3. **Setup:** choose 15, 25 (default), 45, or custom whole minutes (minimum 1), and an engagement goal from 0–100% (default 80%). Start Session unlocks synthesized audio through that user gesture. If sound is unavailable, visual reminders still work and Enable sound offers another attempt.
   Optionally select a second USB webcam under **Desk camera**, then click **Connect desk camera**. Camera A keeps face/head-pose tracking; Camera B adds phone detection for the desk/lap area. The picker excludes A's device, requests the exact selected camera with no audio, and checks that the opened camera is physically different. Leave the picker on **No desk camera** for the original single-camera flow. In Studying with phone mode, the desk picker is hidden and neither phone model nor B is started.
4. **Live:** see time remaining, the confirmed state, and engagement percentage. Pause freezes timing, scoring, and nudges. Away remains a normal observed state: it is excluded from engagement, while the session timer continues.
5. **Summary:** recovery speed leads, followed by engagement against the goal, distraction count, longest distraction, and a segmented timeline. The camera, worker, and models stop when the session ends. New Session reconnects and requires fresh calibration. Change phone policy returns to Start.
6. **History:** available from Start and Summary without activating the camera. View saved summaries oldest first, a recovery-speed chart with gaps for missing recoveries, and a comparison between the first and latest qualifying averages. Returning from History preserves the current summary. Clear history removes saved summaries and turns saving off.

## Local history and Tier 3 verification

Check **Save future session summaries on this device** before starting if you want history. The preference is remembered. Only ended sessions are saved, at most once per app session; unfinished sessions lost to a reload are not restored. Up to 100 summaries are retained, dropping the oldest when full. The stored fields are session dates, planned/active duration, goal, phone policy, end reason, engagement percentage, recovery average/count, distraction count, and longest distraction. No event timelines, head-pose values, calibration, or camera images are persisted.

Sessions with no recoveries have a null recovery average and no chart point, never an invented zero. No-distraction and no-classified-time messages are preserved in the history table. The trend compares the earliest and latest saved sessions with recoveries; it is descriptive and may reflect changes in setup or phone policy. Storage uses the versioned key `focuslens.history.v1` in this browser/site origin. Another browser, device, port, or hostname has separate history. Private browsing or clearing site data may remove it. Turning saving off keeps existing records; Clear history removes them and disables saving. If storage is blocked, full, or unreadable, the app explains this and sessions still work. Malformed/unsupported saved history is not silently overwritten; Clear history can reset it.

Manual checks after refreshing **http://localhost:8000/**:

1. Check the history box, calibrate, and use the length dropdown, custom minutes, numeric goal, and slider. Slider/number and the session-plan preview should agree. Defaults remain 25 minutes and 80% on a fresh load.
2. End a session after one confirmed distraction → engagement recovery. View History from Summary; confirm its average/count and engagement match the summary. Back should restore that summary without restarting the camera.
3. Reload, then open History from Start. The saved summary and opt-in should remain. Complete another session to see the chronological list and trend. Sessions with no recovery must have a chart gap and an explanation in the table.
4. Turn saving off and end another session: existing history should remain without adding that session. Clear history, reload, and verify the list is empty and saving is off.
5. Check Setup and History in a narrow window. The setup fields should stack; the history table can scroll horizontally. A new session must still require fresh calibration.

The small preview remains visible while tracking is active. **Detector diagnostics** is collapsed by default and contains angles, eye scores, phone confidence/age, frame rate, interruption count, calibration centers, raw/candidate/confirmed state, event records, and session metadata.

## Tier 4 USB-camera verification — stop here before Wi-Fi

The full supplied addition is preserved in `TIER4_DUAL_CAMERA.md` and incorporated into `SPEC.md` Section 8. Section 4 explicitly requires USB real-camera verification before implementing the Wi-Fi option. No image-upload routes, phone-camera page, or Wi-Fi camera toggle have been added. Tier 7's separately approved local summary/app API does not authorize camera uploads. The proposed Wi-Fi route still needs agreement to change that privacy model and HTTPS camera access on the phone; a laptop's ordinary LAN HTTP URL is not the phone's localhost.

1. Connect a second USB webcam, refresh **http://localhost:8000/** (hard-refresh if your browser shows the old interface), choose **Phone-free**, Begin, and calibrate normally using Camera A. Verify A still shows your face and head-pose values.
2. In Session Setup, select your second webcam under **Desk camera → Connect desk camera**. If necessary use **Refresh camera list**. Aim B at your notebook/lap area, with your phone visible there. B's preview is unmirrored and its boxes use the same orientation. No additional face calibration is required for B. If opening two cameras is unsupported, an inline desk-camera message should explain the failure and A should remain available.
3. Start a 2-minute session. Keep your face in a study zone and hold the phone below A's field of view but clearly inside B's. After 3 seconds of usable positive readings, expect **Distracted** and **Distraction confirmed from Camera B (desk camera)**. Diagnostics should show B's confidence/result age. A brief appearance under 3 seconds must not confirm distraction.
4. Remove the phone from both views, keep an engaged head pose, and expect engagement after 1 second with fresh A phone-absent readings. Test a visible phone inside A's view too: it should label Camera A. If both views detect a phone at confirmation, A is the deterministic source. Changing source during the same distraction does not create another event or restart the 3-second dwell.
5. Unplug B during a session. Expect a local B warning, no new B evidence, and continued Camera A classification/countdown. Stale or frozen B frames must not keep a phone present forever. Pause, reconnect the webcam, and click **Retry desk camera**, then Resume manually. Denying B permission or a B inference/capture failure should similarly leave A usable. **Use Camera A only** stops B and continues the session. A loss still uses the existing session auto-pause behavior.
6. Pause/resume or hide/return to the tab. Both sources' old readings must be cleared; hidden time must not satisfy a candidate dwell. Look for stable face frame rate and no repeated processing-interruption resets after B is enabled. Report the A/B result ages and face frame rate if classification begins waiting repeatedly.
7. End the session. Confirm both cameras' browser indicators turn off. Summary shows phone-triggered event counts by camera; timeline hover text and Timeline details include Camera B labels. `triggerSource` is recorded only at confirmation on phone-triggered distracted events. Recovery math remains unchanged. Local history retains aggregate summaries only, without source events or camera/device IDs.
8. Start a fresh session with B skipped; then test Studying with phone. Both should behave as before. Also finish the Tier 3 local-history checklist below if not yet tested.

USB testing must establish detection at your actual notebook/lap angle and lighting; synthetic inputs cannot validate those conditions. Optional B being missing/stale means it contributes no positive evidence, not proof that no phone is present. A must still supply fresh phone-absent evidence before engagement can be established in phone-free mode. No camera can detect a phone outside both fields of view.

Both cameras share the existing ObjectDetector instance/model in one worker. Sampling alternates A/B within a **combined** four-samples/second limit, with one bitmap/inference request in flight globally. Each source has independent evidence/freshness and cancellation generations. The VIDEO detector receives a globally increasing inference clock while evidence keeps its actual capture time. B frames must advance rather than repeatedly recapturing a stalled video image. Capture and worker inference errors on B drop B only; a failure of the shared worker/runtime itself remains a tracking failure and follows the existing auto-pause/retry path.

API references: [MediaPipe Web object detection](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js), [camera access and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [device enumeration](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices).

## Tier 5 summary insights

Implemented in the supplied order: pattern tip, then phone-catch markers, then headline sentences. The complete supplied spec is preserved in `TIER5_INSIGHTS_UI.md` and referenced from `SPEC.md` Section 8.

The tip counts confirmed phone-related distractions from either camera, source-free look-away distractions, and drowsy events. It selects the largest count, with phone winning ties over drowsy and drowsy over look-away. Zero matching events shows **No distractions logged this session.** The tip is directly below the four headline stats and above the timeline, using the spec's fixed wording. These are counts, not duration comparisons or causal diagnoses; in particular the supplied look-away wording describes brief, recovered lapses without that being part of its selection rule.

Phone-related distraction spans have dark amber inset borders, explained by the **Phone-related distraction** legend key. Camera A/B labels remain in timeline hover text and Timeline details. Unclassified gaps within a phone event are still unclassified and unmarked. The marker does not change segment length, time accounting, source tags, or event records.

Headline stats use the existing numbers in sentences. Recovery remains the most prominent statement, and durations are expressed in seconds with the same useful decimal precision. The longest value still measures distraction, excluding missing observations; it does not measure the separate away state. No-data and no-recovery states retain their earlier messages. No camera, classifier, calibration, state-machine, logging, scoring, history, or audio code was changed. The insight is for the current in-memory summary only; no new history fields are persisted.

To verify without using a camera, open **http://localhost:8000/tests/summary-browser.html**, click **Run summary checks**, and use the synthetic-session selector. It covers phone, drowsy, look-away, no-distraction, no-recovery, and no-classified-time examples. **Narrow preview** shows the mobile layout. These are explicitly synthetic records, never camera footage. To verify a real session, refresh the main app, finish a session, and check the tip, border legend, and sentence values against Timeline details. Hardware verification of Tier 4 remains a separate pending step.

## Phone and classification rules

- **Phone-free:** a fresh phone detection overrides either study zone. A visible unused phone also counts. Phone-caused or pose-caused raw distraction must persist continuously for 3 seconds before confirmation; there is no second phone debounce.
- **Studying with phone:** phone evidence is ignored; no phone model or worker is created.
- No face → raw away; unusable face data → unknown; closed eyes → eyes_closed; then evaluate phone policy and head pose. Drowsy/away/engaged require their existing 1-second dwell. Unknown resets pending dwell.
- The phone model is EfficientDet-Lite0 int8 v1, filtered to `cell phone`. It runs in a module worker, up to four samples/second with one capture/inference in flight. Confidence starts at 0.55. Results expire 750ms after capture, not arrival. No result or a stale result is unknown, never phone absence. Transferred images are closed and never retained.
- Boxes align with the mirrored preview while labels stay readable. Phones outside the camera view, very small phones, or occluded phones cannot be reliably detected. This estimates engagement; it does not determine what a student is thinking or reading.

Named tolerances and phone settings remain in `js/config.js`. Pose storage/axis conventions are documented in `js/pose.js`; the original camera tests established the starting settings, but different desks/lighting may need retuning.

## Pause, missing readings, and metrics

Hiding the tab, camera loss, a tracking failure, or a frame-processing interruption automatically pauses the session. Returning to the tab or reconnecting does **not** resume automatically. Resume requires fresh camera/phone readings and a click. Keep FocusLens visible in a separate window if you study elsewhere. When a frame gap is detected late, pause at the last observed frame rather than scoring the unobserved interval.

Manual pause leaves the camera available for fresh readings; the timer, scoring, candidates, and nudges stop. Stop camera pauses and releases it. Reconnect camera / retry tracking restores the pipeline, then manual Resume continues with the same calibration. If the physical camera position changed, end the session and start a fresh calibration instead.

Confirmed events retain `{ type, start, end, duration }`, with optional `triggerSource: "cameraA" | "cameraB" | "window"` on phone/app-triggered distraction events. Other events retain their original fields. Timestamps use confirmation time. Ongoing events have null end/duration. Pausing closes the event; resuming begins an active segment with fresh classification. Active segments and unclassified observation periods are separate session metadata, without extra event types. The optional app signal connects through a separate adapter; camera/classifier modules and dwell rules are unchanged. Positive phone evidence wins a simultaneous app-source tie. The app-specific tip has priority after phone and before drowsy/look-away on equal event counts.

- Engagement = classified engaged time / classified engaged + distracted + drowsy time. Away, pause, initial waiting, and missing required readings are excluded. An empty denominator shows waiting during the session and no classified time in the summary.
- Recovery = the full distracted event duration, only when it ends directly in engaged within one active segment and contains no missing-observation period. Distraction → away/drowsy, pause, or session end never counts as recovery.
- Distraction count includes all confirmed distracted events. Longest distraction excludes unclassified portions of that event, consistent with the timeline.
- Timeline spans wall time, with separate colors for the four states and patterns for pauses/unclassified intervals. Timeline details provide an accessible table.
- At/above the goal is a pass; within 10 percentage points below it is near; further below is below goal. Zero distractions shows **No distractions this session**. Distractions without a qualifying recovery show **No recoveries recorded**.

At 15 seconds of an ongoing confirmed distraction, a quiet 440Hz sine tone plays once (150ms envelope, gain 0.08). At 45 seconds, one 440/554Hz two-tone cue plays (gain 0.15) and a dismissible banner appears. The indicator is amber immediately when distraction confirms. Dismissing the banner changes no classification. Neither stage repeats in the same event; new distraction events reset eligibility. No cues play during away, drowsy, paused, or unusable readings. Late UI ticks emit only the highest outstanding cue, avoiding stacked reminders.

## Tier 2 manual acceptance checklist

Use your own working browser, actual desk/camera angle, and demo lighting. Refresh the app before testing.

1. Begin and calibrate. Verify automatic progression to Setup, then choose **Custom → 2 minutes** and start. Look at your screen and notes; engaged should confirm after 1 second. Initial waiting must not count as engagement.
2. In phone-free mode, hold a visible phone inside a study zone, or turn your head outside both zones. Distracted should confirm after 3 seconds. Keep that distraction going: hear one quiet tone 15 seconds after confirmation and a two-tone cue plus banner at 45 seconds. It should not repeat. Dismiss the banner and confirm the state remains distracted.
3. Remove the phone and hold a study pose for 1 second. Engaged should return. This completed distraction should later count as one recovery.
4. Pause for 5 seconds. Check that the timer and percentage freeze and no reminders play. Resume; a fresh classification is required. Switch tabs for 5 seconds and return: the session must remain paused until Resume is clicked.
5. Step out of frame for over 1 second. Away should confirm without reminders; engagement should not fall just because of away time. Close your eyes deliberately for over 1 second: drowsy should confirm, with no reminders.
6. During a distraction, leave the frame or close your eyes. Those distracted events stay in the log/timeline, but must not enter average recovery speed. Pause or end during a distraction and verify the same exclusion.
7. Click Stop camera from the live preview. The session should pause, offer reconnection, and still allow ending for a summary. Reconnect, wait for fresh readings, and Resume manually. No hidden time should be scored as engaged or recovered.
8. End early. Verify the headline recovery duration, event count, engagement against the goal, timeline colors/patterns, and Timeline details. The browser camera indicator should turn off. Detector diagnostics → Session records exposes the corresponding events/segments for inspection.
9. Start New Session. Fresh calibration must be required. Run a 1-minute session to automatic completion. With no distraction events, verify **No distractions this session**. Ending immediately after Start should show no classified time rather than a fabricated score.
10. Repeat with Studying with phone. A visible phone must be ignored and no phone detector should load. Report missed/false detections, unexpected pauses, inaudible or harsh cues, incorrect timing, or summary discrepancies.

The user confirmed this Tier 2 checkpoint before Tier 3 implementation, per `AGENTS.md`. Retain these checks for detector/session regressions.

## Development checks

```sh
node --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Use a recent Node version with native ES-module syntax detection (tested with Node 24). Node is for optional tests only; runtime needs a browser and Python 3.10+, with no installed Python packages.

- **80 JavaScript checks passed:** original face/phone/session/history and insights checks, plus profile isolation/legacy migration, pacing units/median/bounds/storage failure, explicit async report UI, app precedence/source tags/shared dwell, freshness, unavailable-monitor fallback, and late-response isolation.
- **17 Python checks passed:** JSON/profile-scoped APIs, private configuration protection, external-host/cross-site rejection, mocked TLS SMTP and partial delivery, app-name-only polling/allow-list rules, pause/resume revision races, readiness, duplicate launch, unrelated-server preservation, process cleanup, and manifest/icon dimensions. No OS app reading or real email is performed.
- **http://localhost:8000/tests/summary-browser.html:** 30 summary checks cover placement, phone/app marker separation, app-specific tip/counts/source details, unmarked look-aways, unknown gaps, unchanged timeline duration, visible borders/legend, headline precision, goal outcomes, empty cases, and unchanged frozen records. Earlier Tier 5 evidence remains in `tests/results/tier5-summary-check.jpg` and `tests/results/tier5-narrow-summary-check.jpg` (synthetic only).
- **http://localhost:8000/tests/session-browser.html:** 88 interface checks passed with a controlled clock and synthetic detector input, without camera access. Retains prior session/history/desk-camera checks and adds pacing preselection/editability, explicit mocked email status/content, optional app setup, same-profile integration, source tags in both phone policies, unchanged reminders, separate phone/app counts, purple app marker, and app pattern tip. Test profile/pacing use memory and history uses an isolated key removed afterward. Preview buttons include an app-triggered synthetic summary. The native Web Audio check and later user feedback established earlier audio operation; these new checks do not replay real session cues.
- **http://localhost:8000/tests/browser.html:** real CDN/model/WASM loading passed, with two generated HTML video feeds alternating A/B/A/B through one actual worker/model and continued face inference between detections. No camera permission or people/images are used. This validates model compatibility and shared inference, not hardware accuracy/performance. Evidence: `tests/results/tier4-model-check.jpg`.

Controlled inputs and loading checks cannot establish real-camera accuracy or whether a tone is audible and appropriately gentle on your speakers.

Tier 7 synthetic interface evidence: `tests/results/tier7-app-summary.jpg` and `tests/results/tier7-narrow-summary.jpg`. No camera imagery or real recipients appear in these previews.

## Implementation

- `js/app.js`: view flow, camera/model lifecycle, diagnostics, history integration, and interruption handling.
- `js/session.js`: active timer, event/segment metadata, scoring, recoveries, and timeline spans.
- `js/nudges.js`, `js/audio.js`: event-based cue eligibility and Web Audio synthesis.
- `js/summary.js`: duration formatting, summary statistics, and accessible timeline rendering.
- `js/insights.js`: read-only event-count pattern selection and sentence formatting for existing metrics.
- `js/history.js`: opt-in, versioned local summary storage, validation, bounded retention, and trend comparison.
- `js/history-view.js`: recovery chart and accessible chronological history table.
- `js/profile.js`, `js/pacing.js`: local profile metadata and personalized block-length suggestions.
- `js/reports.js`, `email_reports.py`: explicit Summary snapshots, nonblocking report status, and TLS email delivery.
- `js/window-signal.js`, `js/window-fusion.js`: optional fresh app evidence and isolated fusion adapter.
- `window_monitor.py`, `window_rules.py`: macOS app-name-only companion and normalized allow-list rules.
- `server.py`: loopback static files and profile-shaped JSON APIs; credentials/report contents are not stored in API history.
- `start.command`, `launcher.py`, `manifest.json`: ready-checked startup, owned-process cleanup, and standalone-app metadata.
- `js/desk-camera.js`: optional exact-device USB camera lifecycle, advancing-frame freshness, and local failure handling.
- `js/phone-tracker.js` / `js/phone-worker.js`: shared one-model A/B scheduling, per-source evidence, and B error isolation.
- Existing calibration, classifier, camera, tracking, pose, phone worker/controller, and loading modules retain the verified detector pipeline.
