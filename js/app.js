import { Calibration } from "./calibration.js";
import { StateMachine } from "./classifier.js";
import { startCamera, stopCamera, cameraErrorMessage } from "./camera.js";
import { createLandmarker, startTracking } from "./tracking.js";
import { EYE_CLOSED_THRESHOLD, YAW_TOLERANCE_DEG, PITCH_TOLERANCE_DEG, PHONE_CONFIDENCE_THRESHOLD, PHONE_FRESHNESS_MS, MAX_FRAME_GAP_MS } from "./config.js";
import { PhoneTracker } from "./phone-tracker.js";
import { phoneEvidence, mirroredPhoneBox } from "./phone.js";
import { atStage } from "./loading.js";
import { StudySession, sessionMetrics } from "./session.js";
import { DistractionNudges } from "./nudges.js";
import { AudioCues } from "./audio.js";
import { formatCountdown, formatDuration, renderTable, renderSessionSummary } from "./summary.js?v=7";
import { HistoryStore, HISTORY_KEY } from "./history.js?v=7";
import { renderHistory } from "./history-view.js";
import { DeskCamera, listDeskCameras } from "./desk-camera.js";
import { LocalProfile } from "./profile.js";
import { PacingStore } from "./pacing.js";
import { ReportController } from "./reports.js";
import { WindowSignal } from "./window-signal.js";
import { classifyWithWindow } from "./window-fusion.js";

// Optional dependencies let the browser integration fixture exercise this exact
// interface with a controlled clock and detector, without camera permissions.
export function boot(loadVision, overrides = {}) {
  const doc = overrides.document ?? document;
  const host = doc.defaultView;
  const deps = {
    startCamera, stopCamera, createLandmarker, startTracking,
    createDeskCamera: (video, options) => new DeskCamera(video, options),
    listDeskCameras,
    createPhoneTracker: (options) => new PhoneTracker(options),
    createAudioCues: () => new AudioCues(),
    createProfile: () => new LocalProfile(() => host.localStorage),
    createPacingStore: (profileId) => new PacingStore(profileId, () => host.localStorage),
    createHistoryStore: (profileId) => new HistoryStore(() => host.localStorage, profileId),
    createReportController: (document, profileId) => new ReportController(document, profileId),
    createWindowSignal: (profileId, options) => new WindowSignal(profileId, options),
    makeSessionId: () => host.crypto.randomUUID(),
    now: () => performance.now(), epochAt: (now) => performance.timeOrigin + now,
    setInterval: (fn, ms) => host.setInterval(fn, ms), clearInterval: (timer) => host.clearInterval(timer),
    ...overrides,
  };
  const ui = Object.fromEntries([...doc.querySelectorAll("[id]")].map((node) => [node.id, node]));
  const views = [...doc.querySelectorAll("[data-view]")];
  const cleanup = [];
  const listen = (node, event, fn) => { node.addEventListener(event, fn); cleanup.push(() => node.removeEventListener(event, fn)); };
  const set = (id, value) => { if (ui[id].textContent !== String(value)) ui[id].textContent = value; };
  const at = () => deps.epochAt(deps.now());
  const angle = (value) => Number.isFinite(value) ? `${value.toFixed(1)}°` : "—";
  const score = (value) => Number.isFinite(value) ? value.toFixed(3) : "—";
  const calibration = new Calibration();
  const machine = new StateMachine();
  const nudges = new DistractionNudges();
  const audio = deps.createAudioCues();
  const profile = deps.createProfile();
  const profileId = profile.getId();
  const pacing = deps.createPacingStore(profileId);
  const history = deps.createHistoryStore(profileId);
  const reports = deps.createReportController(doc, profileId);
  const windows = deps.createWindowSignal(profileId, { onStatus: (message) => set("window-live-status", message) });
  let historyReturnView = "start";
  let session = null;
  let phase = "start";
  let stream = null;
  let landmarker = null;
  let phoneTracker = null;
  let phoneLoadingStage = "Not started";
  let activePhonePolicy = "phone-free";
  let setupAbort = null;
  let stopLoop = null;
  let operation = 0;
  let tracking = false;
  let pipelineReady = false;
  let connectionPending = false;
  let sessionActionPending = false;
  let finalized = false;
  let latestRaw = null;
  let lastFrameAt = null;
  let gapActive = false;
  let gapCount = 0;
  let frameWindowStart = null;
  let frameCount = 0;
  let lastLogAt = -Infinity;
  let deskDeviceId = "";
  let deskPending = false;
  let deskUsable = false;
  let deviceListOperation = 0;
  let deskConnectionOperation = 0;
  const desk = deps.createDeskCamera(ui["desk-video"], {
    onStatus(message) { set("desk-status", message); set("desk-live-status", message); },
    onUnavailable() { phoneTracker?.invalidateSource("cameraB"); deskPending = deskUsable = false; updateDeskControls(); },
  });

  set("eye-threshold", EYE_CLOSED_THRESHOLD);
  set("yaw-tolerance", YAW_TOLERANCE_DEG);
  set("pitch-tolerance", PITCH_TOLERANCE_DEG);
  set("phone-threshold", PHONE_CONFIDENCE_THRESHOLD);
  set("phone-freshness", PHONE_FRESHNESS_MS);

  function showError(message) {
    set("error", message || "");
    ui.error.hidden = !message;
  }
  function showView(name) {
    const changed = phase !== name;
    phase = name;
    for (const view of views) view.hidden = view.dataset.view !== name;
    ui["camera-panel"].hidden = !stream || name === "summary";
    ui.workflow.classList.toggle("with-preview", !ui["camera-panel"].hidden);
    ui.diagnostics.hidden = !tracking && !session;
    if (changed) doc.querySelector(`[data-view="${name}"] h2`)?.focus({ preventScroll: true });
    if (changed && name === "setup") applyPacing();
    updateControls();
  }
  function updateControls() {
    ui.begin.disabled = connectionPending;
    ui["phone-policy"].disabled = connectionPending || Boolean(stream) || session?.state === "running" || session?.state === "paused";
    ui.calibrate.disabled = !pipelineReady || calibration.active;
    ui["start-session"].disabled = !pipelineReady || !calibration.result || sessionActionPending;
    ui.reconnect.disabled = connectionPending;
    ui["window-enabled"].disabled = session?.state === "running" || session?.state === "paused";
    ui["allowed-apps"].disabled = ui["window-enabled"].disabled;
    updateDeskControls();
  }
  function primaryDeviceId() { return stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId; }
  function updateDeskControls() {
    const locked = session?.state === "running";
    const allowed = activePhonePolicy === "phone-free" && pipelineReady;
    ui["desk-settings"].hidden = activePhonePolicy !== "phone-free";
    ui["desk-device"].disabled = !allowed || locked || deskPending;
    ui["refresh-devices"].disabled = !allowed || locked || deskPending;
    ui["connect-desk"].disabled = !allowed || locked || deskPending || !ui["desk-device"].value;
    ui["desk-preview-panel"].hidden = !stream || !deskDeviceId || !["setup", "live"].includes(phase);
    ui["desk-retry"].hidden = Boolean(desk.stream) || deskPending;
    ui["desk-retry"].disabled = !allowed || locked || deskPending;
    ui["desk-video"].hidden = !desk.stream;
    ui["desk-overlay"].hidden = !desk.stream;
  }
  function stopDesk(clearSelection = true) {
    deskConnectionOperation++;
    desk.stop(); deskPending = deskUsable = false;
    phoneTracker?.invalidateSource("cameraB");
    if (clearSelection) { deskDeviceId = ""; ui["desk-device"].value = ""; }
    const canvas = ui["desk-overlay"];
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    set("desk-phone-status", "Off"); set("desk-phone-confidence", "—"); set("desk-phone-age", "—");
    updateDeskControls();
  }
  async function refreshDeskDevices() {
    if (!pipelineReady || activePhonePolicy !== "phone-free") return;
    const token = ++deviceListOperation;
    const pipeline = operation;
    try {
      const devices = await deps.listDeskCameras(primaryDeviceId());
      if (token !== deviceListOperation || pipeline !== operation) return;
      const selected = ui["desk-device"].value;
      const off = doc.createElement("option"); off.value = ""; off.textContent = "No desk camera · use Camera A only";
      ui["desk-device"].replaceChildren(off);
      for (const device of devices) {
        const option = doc.createElement("option"); option.value = device.id; option.textContent = device.label;
        ui["desk-device"].append(option);
      }
      ui["desk-device"].value = devices.some((device) => device.id === selected) ? selected : "";
      if (!devices.length && !desk.stream) {
        set("desk-status", "No second camera found. Connect a USB webcam and refresh, or continue with Camera A only.");
      }
      updateDeskControls();
    } catch {
      if (token !== deviceListOperation || pipeline !== operation) return;
      set("desk-status", "Camera list unavailable. Camera A still works; reconnect a USB webcam and refresh to retry.");
    }
  }
  async function connectDesk(deviceId = ui["desk-device"].value) {
    if (!pipelineReady || activePhonePolicy !== "phone-free" || session?.state === "running" || !deviceId) return;
    stopDesk(false);
    deskDeviceId = deviceId; deskPending = true;
    const token = ++deskConnectionOperation;
    updateDeskControls();
    try { await desk.start(deviceId, primaryDeviceId()); }
    catch { /* Optional-camera failure is explained locally by DeskCamera. */ }
    finally { if (token === deskConnectionOperation) { deskPending = false; updateDeskControls(); } }
  }
  function refreshHistory(message = "") {
    for (const id of ["save-history", "history-enabled"]) {
      ui[id].checked = history.data.enabled;
      ui[id].disabled = !history.available;
    }
    const status = message || history.message || (history.data.enabled
      ? "History is on. Future session summaries will be saved here."
      : "History is off. Existing summaries stay until you clear them.");
    set("history-start-status", status); set("history-storage-status", status);
    renderHistory(doc, history.data.records);
  }
  function openHistory() {
    if (phase !== "start" && phase !== "summary") return;
    historyReturnView = phase;
    history.load(); refreshHistory();
    set("status", "History stays in this browser on this device.");
    showView("history");
  }
  function renderSetupPlan() {
    const minutes = ui["session-length"].value === "custom" ? ui["custom-length"].valueAsNumber : Number(ui["session-length"].value);
    const goal = ui["engagement-goal"].valueAsNumber;
    set("setup-plan", Number.isFinite(minutes) && minutes >= 1 && Number.isFinite(goal) && goal >= 0 && goal <= 100
      ? `${minutes} ${minutes === 1 ? "minute" : "minutes"} · ${goal}% engagement target`
      : "Choose a session length and a target from 0–100%.");
  }
  function applyPacing() {
    const minutes = pacing.suggestion();
    const hint = ui["pacing-suggestion"];
    hint.hidden = minutes === null && !pacing.message;
    set("pacing-suggestion", minutes === null ? pacing.message : `Based on your past sessions, a ~${minutes} minute block tends to work well for you.`);
    if (minutes === null) return;
    const preset = [...ui["session-length"].options].some((option) => option.value === String(minutes));
    ui["session-length"].value = preset ? String(minutes) : "custom";
    ui["custom-length-field"].hidden = preset;
    ui["custom-length"].disabled = preset; ui["custom-length"].required = !preset;
    if (!preset) ui["custom-length"].value = minutes;
    renderSetupPlan();
  }
  function renderLog() {
    const relative = (time) => formatDuration(time - (session?.startTime ?? time));
    renderTable(doc, ui["event-rows"], (session?.events ?? []).map((event) => [
      `${event.type}${event.triggerSource ? ` · ${event.triggerSource === "window" ? "Active app" : event.triggerSource === "cameraB" ? "Camera B (desk)" : "Camera A"}` : ""}`, relative(event.start), event.end === null ? "Ongoing" : relative(event.end),
      event.duration === null ? "—" : formatDuration(event.duration),
    ]), "No confirmed events yet.");
    ui["event-json"].textContent = session ? JSON.stringify({
      profileId,
      goalMinutes: session.goalMinutes, goalEngagementPct: session.goalEngagementPct, phonePolicy: session.phonePolicy,
      startTime: session.startTime, endTime: session.endTime, state: session.state,
      activeSegments: session.activeSegments, unclassifiedPeriods: session.unclassifiedPeriods, events: session.events,
    }, null, 2) : "[]";
  }
  function renderCalibration(now) {
    const progress = calibration.progress(now);
    if (progress) {
      set("calibration-instruction", `Step ${progress.number}/3 · ${progress.instruction}`);
      set("calibration-countdown", `${Math.ceil(progress.remainingMs / 1000)}s`);
      const pct = progress.totalFrames ? `${(progress.validFrames / progress.totalFrames * 100).toFixed(1)}%` : "—";
      set("calibration-quality", `${progress.validFrames}/${progress.totalFrames} valid frames (${pct}); 90% required.`);
    }
    renderTable(doc, ui["calibration-rows"], Object.entries(calibration.steps).map(([key, step]) => [
      key, angle(step.yaw), angle(step.pitch), `${step.validFrames}/${step.totalFrames} (${(step.validRatio * 100).toFixed(1)}%)`,
    ]), "No calibration yet.");
  }
  function calibrationFailed() {
    set("calibration-error", calibration.error);
    ui["calibration-error"].hidden = false;
    set("calibration-instruction", "Calibration needs another try.");
    set("calibration-countdown", "—");
    set("calibrate", "Retry calibration");
    updateControls();
  }
  function renderPhone(now) {
    const canvas = ui["phone-overlay"];
    const width = ui.video.videoWidth || 640;
    const height = ui.video.videoHeight || 480;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    if (activePhonePolicy === "phone-allowed") {
      set("phone-status", "Off · studying with phone"); set("phone-confidence", "—"); set("phone-age", "Not required");
      return;
    }
    const evidence = phoneEvidence(phoneTracker?.latest, now);
    set("phone-status", !phoneTracker?.ready ? phoneLoadingStage : evidence.status === "unknown"
      ? "Unknown · waiting for fresh result" : evidence.status === "present" ? "Phone detected" : "No phone detected");
    set("phone-confidence", score(evidence.confidence));
    set("phone-age", evidence.ageMs === null ? "No result yet" : `${Math.max(0, evidence.ageMs).toFixed(0)}ms · ${evidence.status === "unknown" ? "stale" : "fresh"}`);
    context.strokeStyle = context.fillStyle = "#ffca70";
    context.lineWidth = Math.max(2, width / 240);
    context.font = `${Math.max(14, width / 42)}px system-ui`;
    for (const box of evidence.boxes) {
      const rect = mirroredPhoneBox(box, width, height);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.fillText(`Phone ${(box.confidence * 100).toFixed(0)}%`, rect.x + 4, Math.max(20, rect.y - 5));
    }
  }
  function renderDeskPhone(now) {
    const canvas = ui["desk-overlay"];
    const width = ui["desk-video"].videoWidth || 640, height = ui["desk-video"].videoHeight || 480;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    const evidence = phoneEvidence(phoneTracker?.deskLatest, now);
    const status = !deskDeviceId ? "Off" : !desk.stream ? "Unavailable · Camera A only"
      : evidence.status === "present" ? "Phone detected · Camera B" : evidence.status === "absent" ? "No phone detected · Camera B" : "No fresh evidence · Camera A only";
    set("desk-phone-status", status); set("desk-phone-confidence", score(evidence.confidence));
    set("desk-phone-age", evidence.ageMs === null ? "No result yet" : `${Math.max(0, evidence.ageMs).toFixed(0)}ms · ${evidence.status === "unknown" ? "stale" : "fresh"}`);
    if (desk.stream && deskUsable && evidence.status !== "unknown") {
      set("desk-status", status); set("desk-live-status", status);
    }
    context.strokeStyle = context.fillStyle = "#ffca70";
    context.lineWidth = Math.max(2, width / 240); context.font = `${Math.max(14, width / 42)}px system-ui`;
    for (const box of evidence.boxes) {
      // Desk view is deliberately unmirrored; boxes use original coordinates.
      context.strokeRect(box.x * width, box.y * height, box.width * width, box.height * height);
      context.fillText(`Phone ${(box.confidence * 100).toFixed(0)}%`, box.x * width + 4, Math.max(20, box.y * height - 5));
    }
  }
  function resetEvidence() {
    windows.reset();
    machine.reset();
    phoneTracker?.invalidate();
    desk.resetFrames(); deskUsable = false;
    latestRaw = null;
    nudges.reset();
    audio.cancel();
    ui["nudge-banner"].hidden = true;
    set("candidate", "—"); set("dwell", "—"); set("confirmed", "Waiting for classification");
  }
  function readyToResume() {
    return pipelineReady && !doc.hidden && !gapActive && lastFrameAt !== null && deps.now() - lastFrameAt <= MAX_FRAME_GAP_MS
      && (activePhonePolicy === "phone-allowed" || phoneEvidence(phoneTracker?.latest, deps.now()).status !== "unknown");
  }
  function pauseSession(reason, time = at()) {
    if (session?.state !== "running") return;
    session.pause(time, reason);
    windows.pause();
    resetEvidence();
    if (session.state === "ended") { finalizeSession(); return; }
    renderLog();
    renderLive();
  }
  function handleGap(info = {}) {
    if (!tracking || gapActive) return;
    gapActive = true;
    set("gap-count", ++gapCount);
    frameWindowStart = null; frameCount = 0;
    set("face-fps", "—");
    const hidden = info.reason === "hidden" || doc.hidden;
    const pauseAt = hidden ? at() : deps.epochAt(lastFrameAt ?? deps.now());
    pauseSession(hidden ? "Paused because FocusLens was hidden. Keep this tab visible, then resume when you’re ready."
      : "Paused because camera processing was interrupted. Wait for fresh readings, then resume.", pauseAt);
    machine.resetCandidate(); phoneTracker?.invalidate(); latestRaw = null;
    if (calibration.active) {
      calibration.fail("Camera processing was interrupted. Keep this tab visible and retry calibration.");
      calibrationFailed();
    }
    set("raw", "Waiting for fresh frames");
  }
  function renderLive() {
    if (!session || phase !== "live") return;
    if (session.state === "running") {
      if (doc.hidden) handleGap({ reason: "hidden" });
      else if (lastFrameAt === null || deps.now() - lastFrameAt > MAX_FRAME_GAP_MS) handleGap({ reason: "frames-stalled" });
      if (session.state === "running" && session.advance(at())) { finalizeSession(); return; }
    }
    if (session.state === "ended") return;
    const paused = session.state === "paused";
    const confirmed = machine.currentConfirmedState;
    set("countdown", formatCountdown(session.remainingMs(at())));
    ui["state-indicator"].dataset.state = paused ? "paused" : confirmed ?? "waiting";
    set("state-indicator", paused ? "Paused" : confirmed ? confirmed[0].toUpperCase() + confirmed.slice(1) : "Waiting for classification");
    const metrics = sessionMetrics(session, at());
    set("engaged-percent", metrics.engagedPct === null ? "Waiting for classified time" : `${metrics.engagedPct.toFixed(1)}% engaged · ${session.goalEngagementPct}% goal`);
    set("live-reading", paused ? "Timer, scoring, and nudges are paused." : latestRaw === null ? "Waiting for usable readings. Unclassified time is excluded from engagement." : "");
    const source = !paused && session.events.at(-1)?.end === null ? session.events.at(-1)?.triggerSource : null;
    set("live-source", source ? `Distraction confirmed from ${source === "window" ? "the active app" : source === "cameraB" ? "Camera B (desk camera)" : "Camera A"}.` : "");
    updateDeskControls();
    ui["pause-notice"].hidden = !paused;
    set("pause-reason", session.pauseReason);
    set("resume-readiness", readyToResume() ? "Fresh readings are available. Resume when you’re ready."
      : connectionPending ? "Reconnecting camera and tracking…" : !pipelineReady ? "Reconnect tracking to resume, or end the session for a summary."
      : "Keep this tab visible and wait for fresh camera and phone readings.");
    ui.reconnect.hidden = !paused || pipelineReady;
    ui["pause-session"].hidden = paused;
    ui["resume-session"].hidden = !paused;
    ui["resume-session"].disabled = !readyToResume() || sessionActionPending;
    const event = session.events.at(-1);
    for (const stage of nudges.update(event, at(), !paused, latestRaw !== null)) {
      if (!audio.play(stage)) {
        set("audio-status", "Sound is unavailable. Visual reminders remain active.");
        ui["enable-audio"].hidden = false;
      }
    }
    ui["nudge-banner"].hidden = paused || latestRaw === null || !nudges.bannerVisible;
    if (ui.diagnostics.open && at() - lastLogAt > 1000) { renderLog(); lastLogAt = at(); }
  }
  function onFrame(frame, now) {
    if (!tracking) return;
    gapActive = false;
    lastFrameAt = now;
    frameWindowStart ??= now; frameCount++;
    if (now - frameWindowStart >= 1000) {
      set("face-fps", (frameCount * 1000 / (now - frameWindowStart)).toFixed(1));
      frameWindowStart = now; frameCount = 0;
    }
    let deskFrame = null;
    try { deskFrame = desk.frame(now); } catch { /* Optional feed must not stop face tracking. */ }
    if (!deskFrame && deskUsable) phoneTracker?.invalidateSource("cameraB");
    deskUsable = Boolean(deskFrame);
    void phoneTracker?.sampleNext(ui.video, deskFrame, now);
    if (!tracking) return;
    renderPhone(now);
    renderDeskPhone(now);
    set("face", frame.faceDetected ? "Detected" : "Not detected");
    set("yaw", angle(frame.pose?.yaw)); set("pitch", angle(frame.pose?.pitch)); set("roll", angle(frame.pose?.roll));
    set("eyes", `${score(frame.eyeBlinkLeft)} / ${score(frame.eyeBlinkRight)}`); set("eye-average", score(frame.eyeClosedScore));
    if (calibration.active) {
      const result = calibration.addFrame(frame, now);
      renderCalibration(now);
      if (result?.error) calibrationFailed();
      if (result?.complete) {
        resetEvidence();
        set("status", "Calibration complete. Choose your session.");
        set("setup-policy", activePhonePolicy === "phone-free" ? "Phone-free session" : "Studying with phone");
        showView("setup");
      }
    }
    const observation = classifyWithWindow(frame, calibration.result, {
      phonePolicy: activePhonePolicy, phoneSample: phoneTracker?.latest, deskPhoneSample: deskUsable ? phoneTracker?.deskLatest : null, now,
    }, windows.offTask());
    latestRaw = observation.state;
    set("raw", latestRaw ?? "Unclassified"); set("reason", observation.reason);
    set("live-reason", observation.reason);
    if (session?.state === "running") {
      const time = deps.epochAt(now);
      session.observe(latestRaw !== null, time);
      if (session.state === "ended") { finalizeSession(); return; }
      const transition = machine.update(latestRaw, now);
      if (transition) { session.confirm({ ...transition, at: deps.epochAt(transition.at), triggerSource: observation.triggerSource }); renderLog(); }
    }
    const progress = machine.candidateProgress(now);
    set("candidate", progress?.state ?? "—");
    set("dwell", progress ? `${formatDuration(progress.elapsedMs)} / ${formatDuration(progress.requiredMs)}` : "—");
    set("confirmed", machine.currentConfirmedState ?? "Waiting for classification");
    renderLive();
  }
  function disconnectPipeline({ resetCalibration = false } = {}) {
    operation++;
    deviceListOperation++;
    tracking = pipelineReady = connectionPending = false;
    stopDesk(resetCalibration);
    stopLoop?.(); stopLoop = null;
    setupAbort?.abort(); setupAbort = null;
    phoneTracker?.stop(); phoneTracker = null;
    deps.stopCamera(ui.video, stream); stream = null;
    try { landmarker?.close(); } catch { /* Finish cleanup after a graph failure. */ }
    landmarker = null;
    if (resetCalibration) calibration.reset();
    lastFrameAt = null; gapActive = false;
    const canvas = ui["phone-overlay"];
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    ui["camera-panel"].hidden = true;
    ui.workflow.classList.remove("with-preview");
    for (const id of ["face", "yaw", "pitch", "roll", "eyes", "eye-average", "phone-confidence", "phone-age", "face-fps"]) set(id, "—");
    set("phone-status", "Not started");
    updateControls();
  }
  function pipelineFault(message, error) {
    if (session?.state === "running") pauseSession(message, deps.epochAt(lastFrameAt ?? deps.now()));
    if (session?.state === "ended") return;
    const paused = session?.state === "paused";
    disconnectPipeline({ resetCalibration: !paused });
    resetEvidence();
    set("status", message);
    if (error) showError(error.message);
    if (paused) { session.pauseReason = message; showView("live"); renderLive(); }
    else showView("start");
  }
  async function connectPipeline(resumeSession = false) {
    disconnectPipeline({ resetCalibration: !resumeSession });
    const token = ++operation;
    connectionPending = true;
    activePhonePolicy = resumeSession ? session.phonePolicy : ui["phone-policy"].value;
    setupAbort = new AbortController();
    gapCount = 0; frameWindowStart = null; frameCount = 0; set("gap-count", "0");
    resetEvidence(); showError(null); updateControls();
    set("status", "Requesting camera access…");
    try {
      const nextStream = await deps.startCamera(ui.video, () => {
        if (token === operation) pipelineFault("Camera disconnected. Reconnect tracking, then resume.");
      });
      if (token !== operation) { nextStream.getTracks().forEach((track) => track.stop()); return; }
      stream = nextStream;
      showView(phase);
      set("status", "Camera connected. Loading the tracking library…");
      const vision = await atStage("library", loadVision);
      if (token !== operation) return;
      const nextLandmarker = await deps.createLandmarker(vision, {
        signal: setupAbort.signal,
        onStage(stage) { if (token === operation) set("status", stage === "face-model" ? "Downloading the face model…" : "Initializing face tracking runtime / WASM…"); },
      });
      if (token !== operation) { nextLandmarker.close(); return; }
      landmarker = nextLandmarker;
      tracking = true;
      stopLoop = deps.startTracking(ui.video, landmarker, {
        onFrame, onGap: handleGap,
        onError(error) { if (token === operation) pipelineFault("Face tracking stopped. Retry tracking, then resume.", error); },
      });
      if (activePhonePolicy === "phone-free") {
        phoneLoadingStage = "Loading phone detector…";
        set("status", "Face tracking ready. Loading phone detection…");
        phoneTracker = deps.createPhoneTracker({
          onStage(stage) {
            if (token !== operation) return;
            phoneLoadingStage = stage === "library" ? "Loading phone tracking library…"
              : stage === "phone-model" ? "Downloading phone model…" : "Initializing phone runtime / WASM…";
            set("status", `Face tracking ready. ${phoneLoadingStage}`);
          },
          onError(error) { if (token === operation) pipelineFault("Phone detection stopped. Retry tracking, then resume.", error); },
          onSourceError(error) {
            if (token !== operation) return;
            desk.fail(`Desk phone detection unavailable: ${error.message}. Camera A is still running. Pause to retry the desk camera.`);
          },
        });
        await phoneTracker.start();
        if (token !== operation) return;
      }
      pipelineReady = true; connectionPending = false;
      void refreshDeskDevices();
      set("status", "Camera and tracking ready.");
      if (resumeSession) { showView("live"); renderLive(); }
      else {
        set("calibration-instruction", "Get your screen and notes ready, then start calibration.");
        set("calibration-countdown", "—");
        set("calibration-quality", "Each step needs at least 90% valid face readings.");
        ui["calibration-error"].hidden = true;
        set("calibrate", "Start calibration");
        showView("calibration");
      }
    } catch (error) {
      if (token !== operation) return;
      pipelineFault("Camera / tracking setup did not finish. Retry when you’re ready.", new Error(cameraErrorMessage(error)));
    }
  }
  function finalizeSession() {
    if (!session || session.state !== "ended" || finalized) return;
    finalized = true;
    windows.stop();
    resetEvidence();
    disconnectPipeline({ resetCalibration: true });
    showError(null);
    renderSessionSummary(doc, session);
    reports.setSession(session);
    pacing.save(session);
    renderLog();
    const saved = history.save(session);
    set("summary-save-status", saved.message);
    refreshHistory();
    set("status", "Session finished. Camera stopped.");
    showView("summary");
  }
  function backToStart() {
    windows.stop();
    reports.setSession(null);
    disconnectPipeline({ resetCalibration: true });
    session = null; finalized = false; resetEvidence();
    showError(null); set("status", "Ready when you are.");
    renderLog(); showView("start");
  }
  function startCalibration() {
    if (!pipelineReady || doc.hidden) return;
    calibration.start(); resetEvidence();
    ui["calibration-error"].hidden = true;
    set("status", "Follow the three calibration prompts.");
    showView("calibration"); renderCalibration(deps.now());
  }
  async function beginSession(event) {
    event.preventDefault();
    if (sessionActionPending || !pipelineReady || !calibration.result || !ui["setup-form"].reportValidity()) return;
    const goalMinutes = ui["session-length"].value === "custom" ? ui["custom-length"].valueAsNumber : Number(ui["session-length"].value);
    let nextSession;
    try { nextSession = new StudySession({ goalMinutes, goalEngagementPct: ui["engagement-goal"].valueAsNumber, phonePolicy: activePhonePolicy }); }
    catch (error) { showError(error.message); return; }
    const token = operation;
    sessionActionPending = true; updateControls();
    const enabled = await audio.unlock();
    sessionActionPending = false; updateControls();
    if (token !== operation || phase !== "setup") return;
    if (!readyToResume()) { showError("Wait for fresh camera and phone readings before starting."); return; }
    showError(null);
    session = nextSession; finalized = false;
    reports.setSession(null);
    resetEvidence(); session.start(at());
    windows.start(deps.makeSessionId(), { enabled: ui["window-enabled"].checked,
      allowedApps: ui["allowed-apps"].value.split(/[,\n]/).map((name) => name.trim()).filter(Boolean).slice(0, 20) });
    ui["enable-audio"].hidden = enabled;
    set("audio-status", enabled ? "Gentle audio reminders are enabled." : "Sound is unavailable. Visual reminders remain active.");
    set("status", "Session running. Keep FocusLens visible while you study.");
    showView("live"); renderLog(); renderLive();
  }
  async function resumeSession() {
    if (sessionActionPending || session?.state !== "paused" || !readyToResume()) return;
    const current = session;
    sessionActionPending = true; renderLive();
    const enabled = await audio.unlock();
    sessionActionPending = false;
    if (session !== current || current.state !== "paused" || !readyToResume()) { renderLive(); return; }
    resetEvidence(); session.resume(at());
    windows.resume();
    ui["enable-audio"].hidden = enabled;
    set("audio-status", enabled ? "Gentle audio reminders are enabled." : "Sound is unavailable. Visual reminders remain active.");
    showError(null); set("status", "Session resumed."); renderLog(); renderLive();
  }

  listen(ui.begin, "click", () => { session = null; finalized = false; void connectPipeline(); });
  listen(ui.calibrate, "click", startCalibration);
  listen(ui["redo-calibration"], "click", startCalibration);
  listen(ui["cancel-calibration"], "click", backToStart);
  listen(ui["setup-form"], "submit", beginSession);
  listen(ui["session-length"], "change", () => {
    const custom = ui["session-length"].value === "custom";
    ui["custom-length-field"].hidden = !custom; ui["custom-length"].required = custom; ui["custom-length"].disabled = !custom;
    renderSetupPlan();
  });
  listen(ui["custom-length"], "input", renderSetupPlan);
  listen(ui["desk-device"], "change", () => {
    if (!ui["desk-device"].value) { stopDesk(); set("desk-status", "Desk camera off. Using Camera A only."); }
    updateDeskControls();
  });
  listen(ui["connect-desk"], "click", () => void connectDesk());
  listen(ui["desk-retry"], "click", () => void connectDesk(deskDeviceId));
  listen(ui["refresh-devices"], "click", () => void refreshDeskDevices());
  listen(ui["stop-desk"], "click", () => { stopDesk(); set("desk-status", "Desk camera off. Using Camera A only."); });
  listen(ui["engagement-goal"], "input", () => {
    if (ui["engagement-goal"].validity.valid) ui["goal-range"].value = ui["engagement-goal"].value;
    renderSetupPlan();
  });
  listen(ui["goal-range"], "input", () => { ui["engagement-goal"].value = ui["goal-range"].value; renderSetupPlan(); });
  for (const id of ["save-history", "history-enabled"]) listen(ui[id], "change", () => {
    history.setEnabled(ui[id].checked); refreshHistory();
  });
  listen(ui["open-history"], "click", openHistory);
  listen(ui["summary-history"], "click", openHistory);
  listen(ui["history-back"], "click", () => {
    showView(historyReturnView);
    set("status", historyReturnView === "summary" ? "Session finished. Camera stopped." : "Ready when you are.");
  });
  listen(ui["clear-history"], "click", () => {
    const cleared = history.clear(); refreshHistory(cleared ? "History cleared. Saving is now off." : history.message);
    if (cleared && session?.state === "ended") set("summary-save-status", "Saved history was cleared. This session summary is still visible in this tab.");
  });
  listen(ui["clear-pacing"], "click", () => {
    set("pacing-clear-status", pacing.clear() ? "Pacing history cleared for this local profile." : pacing.message);
  });
  listen(host, "storage", (event) => {
    if (event.key === HISTORY_KEY || event.key === null) { history.load(); refreshHistory(); }
  });
  listen(ui["pause-session"], "click", () => pauseSession("Paused. Resume when you’re ready."));
  listen(ui["resume-session"], "click", () => void resumeSession());
  listen(ui.reconnect, "click", () => void connectPipeline(true));
  listen(ui["end-session"], "click", () => {
    renderLive();
    if (session && session.state !== "ended") { session.end(at()); finalizeSession(); }
  });
  listen(ui["stop-camera"], "click", () => {
    if (session?.state === "running" || session?.state === "paused") pipelineFault("Camera stopped. Reconnect tracking to resume, or end the session.");
    else backToStart();
  });
  listen(ui["dismiss-nudge"], "click", () => { nudges.dismiss(); ui["nudge-banner"].hidden = true; });
  listen(ui["enable-audio"], "click", async () => {
    const enabled = await audio.unlock();
    ui["enable-audio"].hidden = enabled;
    set("audio-status", enabled ? "Gentle audio reminders are enabled." : "Sound is unavailable. Visual reminders remain active.");
  });
  listen(ui["new-session"], "click", () => { reports.setSession(null); session = null; finalized = false; showView("calibration"); void connectPipeline(); });
  listen(ui["change-policy"], "click", backToStart);
  listen(ui.diagnostics, "toggle", () => { if (ui.diagnostics.open) renderLog(); });
  listen(doc, "visibilitychange", () => { if (doc.hidden) handleGap({ reason: "hidden" }); });
  listen(ui.video, "waiting", () => handleGap({ reason: "camera-waiting" }));
  const mediaDevices = host.navigator.mediaDevices;
  if (mediaDevices?.addEventListener) listen(mediaDevices, "devicechange", () => { if (session?.state !== "running") void refreshDeskDevices(); });
  const timer = deps.setInterval(renderLive, 100);
  function dispose() {
    windows.dispose();
    reports.dispose();
    if (session?.state === "running") session.pause(at(), "Page closed.");
    deps.clearInterval(timer);
    for (const remove of cleanup) remove();
    disconnectPipeline({ resetCalibration: true });
    void audio.close();
  }
  listen(host, "pagehide", dispose);
  set("profile-status", profile.message);
  renderCalibration(deps.now()); renderLog(); refreshHistory(); renderSetupPlan(); showView("start");
  return { dispose };
}
