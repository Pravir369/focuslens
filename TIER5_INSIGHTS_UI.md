# FocusLens — Tier 5 Addition: Insight Layer on the Summary Screen

Add this as Tier 5 in `SPEC.md` Section 8, after Tier 4. Read in full before writing code.

## 1. Goal

Right now the Summary screen (SPEC.md Section 7, Screen 5) reports numbers. This tier turns the same, already-collected event log into one synthesized observation plus a suggestion, and makes the existing stats read as sentences instead of labels. **This is a presentation layer only.** It does not touch the camera pipeline, the classifier, the hysteresis logic, or the event-logging format from any earlier tier. If anything in this file seems to require changing how events are captured, stop and flag it rather than touching Tier 1–4 code.

## 2. Build order — do in this sequence, each is independently shippable

1. **Pattern tip (Section 3)** — highest value, do this first.
2. **Timeline phone-catch marker (Section 4)** — near-zero cost, do second.
3. **Headline stats as sentences (Section 5)** — lowest cost, do last, first to cut if time runs out.

Each of these three is independent — if time runs out after step 1 or step 2, stop there. A partially-completed Tier 5 is fine; a broken Tier 1–4 is not. Do not let this tier risk anything already working.

## 3. Pattern tip (build first)

On the Summary screen, from the session's event log, compute three counts:

```js
const phoneCount = events.filter(e => e.type === "distracted" && (e.triggerSource === "cameraA" || e.triggerSource === "cameraB")).length;
const lookAwayCount = events.filter(e => e.type === "distracted" && !e.triggerSource).length;
const drowsyCount = events.filter(e => e.type === "drowsy").length;
```

(`triggerSource` is the field added in Tier 4 — only present on phone-triggered distracted events. A plain look-away distracted event has no `triggerSource`.)

**Selection logic — pick the dominant pattern:**

- If `phoneCount + lookAwayCount + drowsyCount === 0`: show a positive-session message (no tip needed — don't force one). Example: "No distractions logged this session."
- Otherwise, pick whichever of the three counts is highest.
- **Tie-break order, if two or more counts are equal:** phone takes priority over drowsy, drowsy takes priority over look-away. (Phone-pattern feedback is the most actionable, so it wins ties. This is an arbitrary but deterministic rule — don't spend time debating it, just implement it as stated.)

**Fixed message per category** (single string per case is fine — don't build a rotating pool of phrasing variants, that's unnecessary scope for today):

- Phone dominant: "Most of today's lapses were phone-related. Try leaving it in another room next session."
- Drowsy dominant: "Several drowsy moments today — this might be a session-timing issue more than a focus issue. Try studying earlier, or take a short break before you start."
- Look-away dominant: "Most lapses were brief look-aways, not phone use — your attention drifted but came back on its own, which your recovery-speed number below reflects."
- No events: "No distractions logged this session."

**Placement:** directly below the four headline stats (Section 7, Screen 5 in `SPEC.md`), above the timeline visualization bar. It should read as the synthesis of the numbers above it and the bridge into the visual detail below it — not a separate, disconnected card.

## 4. Timeline phone-catch marker (build second)

The Summary screen's existing timeline bar (SPEC.md Section 7, Screen 5) color-segments by state. Add one more visual distinction: segments where `triggerSource === "cameraA"` or `"cameraB"` get a distinct marker — a small icon, a different border, or a slightly different shade of the existing "distracted" color, your call on exact styling — so a phone-catch is visually distinguishable from a plain look-away at a glance.

This is a styling-only change to an element that already exists and already has the data it needs (the `triggerSource` tagging was already added in Tier 4). No new logic beyond a conditional class/style based on a field that's already there.

## 5. Headline stats as sentences (build last, cut first if short on time)

Reword the existing headline stats (SPEC.md Section 7, Screen 5, items 1–4) from labels into short plain sentences, using the exact same underlying numbers — this is a string-templating change only, not a data change:

- "Avg recovery speed: Xs" → "You got back on track in about X seconds on average."
- Engagement % vs. goal — keep the existing pass/near/miss framing from Tier 2/3, just confirm the wording reads as a sentence, not a label (e.g., "You hit your goal" rather than "Goal: met").
- "Distraction events: N" → "N moments of distraction this session."
- "Longest streak: Xs" → "Your longest stretch away was about X seconds."

No new computation — these are the same four stats already being calculated, just rendered as sentences instead of `label: value` pairs.
