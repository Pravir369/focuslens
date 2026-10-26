import test from "node:test";
import assert from "node:assert/strict";
import { ReportController, sessionReport } from "../js/reports.js";
import { StudySession } from "../js/session.js";

function session() {
  const value = new StudySession(); value.start(0);
  value.confirm({ from: null, to: "distracted", at: 3000, triggerSource: "cameraB" });
  value.confirm({ from: "distracted", to: "engaged", at: 8000 }); value.end(10000);
  return value;
}
function fixture(fetcher) {
  const fields = { "report-email": { value: "" }, "report-email-extra": { value: "" }, "send-report": { disabled: true }, "report-status": { textContent: "" } };
  const inputs = [fields["report-email"], fields["report-email-extra"]];
  fields["report-form"] = { addEventListener() {}, removeEventListener() {}, reportValidity: () => true,
    reset() { inputs.forEach((input) => { input.value = ""; }); }, querySelectorAll: () => inputs };
  const controller = new ReportController({ getElementById: (id) => fields[id] }, "profile-one", { fetcher, delay: (fn) => { queueMicrotask(fn); return 1; }, cancelDelay() {} });
  controller.setSession(session());
  fields["report-email"].value = "student@example.com";
  return { controller, fields };
}
test("report reuses summary values, tip, and textual source timeline without camera/raw data", () => {
  const value = sessionReport(session());
  assert.match(value.headlineStats.recovery, /5 seconds/); assert.match(value.patternTip, /phone-related/);
  assert.ok(value.timeline.some((row) => row.state.includes("Camera B")));
  for (const key of ["events", "images", "pose", "calibration"]) assert.equal(Object.hasOwn(value, key), false);
});
test("email is explicit, carries profileId, polls nonblocking, and clears addresses on success", async () => {
  const calls = [];
  const f = fixture(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => calls.length === 1 ? { reportId: "report-one", status: "sending", profileId: "profile-one" } : { status: "sent", sentCount: 1 } }; });
  assert.equal(calls.length, 0);
  await f.controller.send();
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.profileId, "profile-one"); assert.deepEqual(body.recipientEmails, ["student@example.com"]);
  assert.match(calls[1].url, /profileId=profile-one/);
  assert.equal(f.fields["report-email"].value, ""); assert.match(f.fields["report-status"].textContent, /sent to 1/);
  f.controller.dispose();
});
test("sending failures remain inline and do not disable the session summary", async () => {
  const f = fixture(async () => ({ ok: false, json: async () => ({ error: "Email is not configured" }) }));
  await f.controller.send();
  assert.match(f.fields["report-status"].textContent, /not configured/);
  assert.equal(f.fields["send-report"].disabled, false); assert.equal(f.fields["report-email"].disabled, false);
  f.controller.dispose();
});
test("new session clears recipients and ignores an old pending response; duplicate clicks do not submit twice", async () => {
  let resolve, posts = 0;
  const f = fixture(() => { posts++; return new Promise((done) => { resolve = done; }); });
  const pending = f.controller.send();
  await f.controller.send(); assert.equal(posts, 1);
  f.controller.setSession(null);
  resolve({ ok: true, json: async () => ({ reportId: "old", status: "sent", sentCount: 1 }) }); await pending;
  assert.equal(f.fields["report-status"].textContent, ""); assert.equal(f.fields["report-email"].value, "");
  assert.equal(f.fields["send-report"].disabled, true); f.controller.dispose();
});
