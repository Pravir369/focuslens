const TO_DEGREES = 180 / Math.PI;

export function angleDifference(a, b) {
  return ((a - b + 540) % 360 + 360) % 360 - 180;
}

export function meanAngle(values) {
  const radians = values.map((angle) => angle / TO_DEGREES);
  return Math.atan2(
    radians.reduce((sum, angle) => sum + Math.sin(angle), 0),
    radians.reduce((sum, angle) => sum + Math.cos(angle), 0),
  ) * TO_DEGREES;
}

export function matrixToEulerAngles(matrix) {
  if (matrix?.rows !== 4 || matrix?.columns !== 4 || matrix.data?.length !== 16) {
    return null;
  }
  const m = matrix.data;
  if (!Array.from(m).every(Number.isFinite)) return null;

  // MediaPipe MatrixData is column-major: m[column * 4 + row].
  // Remove uniform scale before extracting R = Rz(roll) * Ry(yaw) * Rx(pitch).
  // Right-handed metric camera axes: +X right, +Y up, camera looks down -Z.
  // Positive yaw turns the canonical face normal toward +X; positive pitch
  // tilts it toward -Y; positive roll rotates +X toward +Y. Degrees throughout.
  // Inference uses the unmirrored video; ONLY the preview is mirrored by CSS.
  // Verify actual direction/sign empirically in the debug view before tuning.
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  if (Math.min(sx, sy, sz) < 1e-8) return null;
  const r00 = m[0] / sx;
  const r10 = m[1] / sx;
  const r20 = m[2] / sx;
  const r11 = m[5] / sy;
  const r21 = m[6] / sy;
  const r12 = m[9] / sz;
  const r22 = m[10] / sz;
  const horizontal = Math.hypot(r00, r10);
  const yaw = Math.atan2(-r20, horizontal);
  const pitch = horizontal > 1e-6 ? Math.atan2(r21, r22) : Math.atan2(-r12, r11);
  const roll = horizontal > 1e-6 ? Math.atan2(r10, r00) : 0;
  return { yaw: yaw * TO_DEGREES, pitch: pitch * TO_DEGREES, roll: roll * TO_DEGREES };
}
