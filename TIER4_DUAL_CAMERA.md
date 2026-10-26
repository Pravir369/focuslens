# FocusLens — Tier 4 Addition: Dual-Camera Phone Detection

Add this as Tier 4 in `SPEC.md` Section 8, after Tier 3. This file is the full spec for it — read it in full before writing any code. **Build order within this file matters as much as the tiers themselves** — see Section 4 below. Given how little time is left, do not reorder it.

## 1. Problem this solves

Camera A (the existing front-facing camera) already detects a phone when it's visible in-frame, per the existing object-detection check in the raw-state logic. But a phone held in the lap or below the desk edge is physically outside Camera A's field of view — no amount of software fixes a frame that was never captured. This adds a second, independently-positioned camera aimed at the desk/lap area, running object detection only (no face tracking), to cover that blind spot.

## 2. What does NOT change

- Camera A's pipeline (face landmarks, head-pose zones, calibration, hysteresis state machine) is untouched.
- The debounce/hysteresis timing logic (SPEC.md Section 5.3) is untouched. This feature only adds a new input into the existing raw-state computation — it does not add a new state machine.
- No WebRTC, no peer-to-peer video, no signaling server. Explicitly rejected as out of scope for the time remaining — see Section 5 for why.

## 3. Architecture

Two independent ways to supply Camera B's video feed, built in this priority order:

**3a. USB webcam (build this first — it alone fully fixes the bug)**
A second physical camera, selected via `navigator.mediaDevices.enumerateDevices()`, filtered to `kind === "videoinput"`. Standard `getUserMedia` call against that specific `deviceId`, feeding a second hidden `<video>` element — architecturally identical to Camera A, just a second instance.

**3b. Phone-as-camera over local WiFi (build this second, only if 3a is done and time remains)**
No app install on the phone. The existing local Python server (already running to serve the app) gets two new routes:
- `POST /upload-frame` — phone's browser posts a JPEG blob roughly once per second; server holds only the single most recent frame in memory (overwrite, don't accumulate — no need to store history).
- `GET /latest-frame` — laptop app polls this to retrieve the most recent frame as a blob.

A new static page, `phone-cam.html`, served by the same local server. Phone visits it in its own browser over WiFi (same network as the laptop) — `getUserMedia` on the phone, draw each captured frame to a `<canvas>`, convert to a blob, `POST` it to `/upload-frame` on an interval (~1000ms is sufficient — this does not need to be fast, since the laptop only polls at the same rate anyway).

On the laptop side, Camera B's loop in this mode is just: every ~1000ms, `fetch("/latest-frame")`, run the object detector against whatever image comes back.

## 4. Build order — do this first, do not start 3b before 3a is verified working

1. Build 3a (USB webcam) completely and confirm it catches a phone held at notebook angle, out of Camera A's view, in real testing.
2. **Stop. This alone fully resolves the loophole.** If you're running low on time after this step, stop here — ship with the USB webcam path only, and mention the phone-as-camera option as a stated "didn't have time to finish" item in your submission rather than risk breaking a working feature by continuing.
3. Only if real time remains: build 3b (the server routes + `phone-cam.html` + polling client code), as an *additional* source option alongside 3a, not a replacement for it.

## 5. Why phone-as-camera is scoped as polling over HTTP, not live video

A fully "native, no download" live video connection from a phone browser to the laptop requires WebRTC — signaling, STUN/TURN, SDP negotiation. That's a multi-hour, failure-prone build on a normal day, let alone what's left of today. Polling a single most-recent image over plain HTTP sidesteps all of that: no signaling, no negotiation, just a POST and a GET against a server you already have running. The object detector doesn't need continuous video — it's already throttled — so a fresh still image roughly once a second is functionally equivalent for this purpose.

## 6. Object detection on Camera B

Reuse the exact same `ObjectDetector` instance and model already loaded for Camera A's in-frame phone check — do not load a second copy of the model. Just call `.detect()` against whichever image source is active (Camera B's `<video>` frame in 3a, or the polled image in 3b), checking for the same `"Cell Phone"` category above the same confidence threshold already in use.

## 7. Fusion into the existing raw-state logic

This is the only change to the actual classification code. The existing priority chain (SPEC.md Section 5.2) gets Camera B folded into the same phone-check branch:

```
if (no face detected on Camera A)        → rawState = "away"
else if (eyesClosed)                     → rawState = "eyes_closed"
else if (phoneVisible_CameraA OR phoneVisible_CameraB) → rawState = "distracted"
else if (pose inside a zone)             → rawState = "engaged"
else                                      → rawState = "distracted"
```

Everything downstream — the 3-second/1-second debounce, event logging, recovery-speed calculation — is completely unchanged. This is one boolean OR added to one existing condition.

**Tag the event source for the demo:** when this branch fires, record which camera triggered it (`triggerSource: "cameraA" | "cameraB"`) on the event. Lets your Summary timeline or demo narration say specifically "caught by the desk camera" — a concrete, visible detail worth having for the three-minute demo.

## 8. Resilience — Camera B must be allowed to fail without breaking Camera A

Camera B is a second, lower-priority input, not a dependency. If it's disconnected, the phone hasn't connected yet, or `/latest-frame` hasn't received an upload yet:
- `phoneVisible_CameraB` simply evaluates to `false` (treat "no data" as "no phone detected," not as an error).
- Camera A's pipeline must keep running normally regardless of Camera B's state.
- Do not let a missing or stale Camera B feed throw an unhandled error anywhere in the raw-state loop — wrap its check in a try/catch that falls back to `false` on any failure. This matters most during a live demo, where a flaky second camera is a realistic failure mode and should degrade gracefully, not crash the app.

## 9. UI changes

Add to Session Setup (or a small step just before it):
- A device picker for Camera B: lists available video input devices (from `enumerateDevices()`), one of which may be the phone if it's already connected via 3a-style USB/droidcam-type passthrough — but that's incidental, not the primary path.
- A toggle or second option: "Use phone as desk camera" — when selected, display the local server's URL as plain text (e.g., `http://192.168.1.x:8000/phone-cam.html`) for the user to type into their phone's browser manually. **Do not build a QR code generator for this** — typing a short local URL is faster to build and just as fast to use, and one less thing to get wrong today.
- Keep this entire picker skippable — if the user doesn't select a Camera B source, the app should run exactly as it did before this feature existed (Camera A only).
