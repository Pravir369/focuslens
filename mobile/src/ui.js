import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Electric Pop 2.0 — the design-token layer for the native companion.
// React Native has no CSS variables, so this object is the mobile mirror of the
// :root blocks in ../../styles.css, ../../account.css and
// ../../companion/styles.css. Token names and values match those files; change
// all four together. Accent "*Text" values are the lightest step of each accent
// that still clears 4.5:1 on surface and raised.
export const tokens = {
  color: {
    bg: '#242B40', surface: '#373950', raised: '#444660', inset: '#2D3147',
    border: '#555773', borderSoft: '#474A64',

    text: '#F5F7FF', text2: '#C0C7DE', text3: '#969FBC', text3Up: '#AFB6CC',
    onAccent: '#FFFFFF', onBright: '#0B1020',

    cobalt: '#3D7BFF', cyan: '#12CFE3', coral: '#FF6B6B', violet: '#8D7CFF', lime: '#B7F542',
    cobaltText: '#94B6FF', cyanText: '#18D8ED', coralText: '#FF9E9E',
    violetText: '#B9AFFF', limeText: '#B7F542',
    cobaltFill: '#236AFF',

    cobaltTint: '#384570', cobaltEdge: '#395292',
    cyanTint: '#30546A', cyanEdge: '#297288',
    coralTint: '#5B4255', coralEdge: '#834C5A',
    violetTint: '#464570', violetEdge: '#585292',

    engaged: '#28D17C', engagedTint: '#345458', engagedText: '#5CE3A2',
    fault: '#FF4D5D', faultTint: '#5B3D52', faultText: '#FF9AA3',
  },
  space: { s1: 4, s2: 8, s3: 12, s4: 16, s5: 24, s6: 32, s7: 48 },
  radius: { sm: 8, md: 12, lg: 18, pill: 999 },
  // Real per-weight faces bundled under ../assets/fonts and registered in App.js.
  font: {
    displayBold: 'Manrope-Bold', displayHeavy: 'Manrope-ExtraBold',
    body: 'Inter-Regular', medium: 'Inter-Medium', semibold: 'Inter-SemiBold',
  },
};
const c = tokens.color, s = tokens.space, r = tokens.radius, f = tokens.font;

export function Button({ children, onPress, secondary = false, disabled = false, testID }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} testID={testID} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && { opacity: .6 }]}>
    <Text style={[styles.buttonText, secondary && { color: c.cobaltText }]}>{children}</Text>
  </Pressable>;
}

// `accent` tints the whole 1px edge rather than painting a thick stripe on one
// side: enough to tell panels apart in a long scroll, without the accent bar.
export function Card({ children, accent = 'quiet' }) {
  return <View style={[styles.card, accentEdge[accent] || accentEdge.quiet]}>{children}</View>;
}
const accentEdge = StyleSheet.create({
  cobalt: { borderColor: c.cobaltEdge }, cyan: { borderColor: c.cyanEdge },
  coral: { borderColor: c.coralEdge }, violet: { borderColor: c.violetEdge },
  lime: { borderColor: c.borderSoft }, engaged: { borderColor: c.engaged },
  quiet: { borderColor: c.borderSoft },
});

// A labelled statistic: the number carries the weight, the label says what it is.
export function Stat({ value, label, tone = 'lime' }) {
  const colors = { lime: c.limeText, cyan: c.cyanText, cobalt: c.cobaltText, coral: c.coralText };
  return <View style={styles.statBlock}>
    <Text style={[styles.stat, { color: colors[tone] || c.limeText }]}>{value}</Text>
    {Boolean(label) && <Text style={styles.statLabel}>{label}</Text>}
  </View>;
}

// A tinted strip for supporting notes, so secondary information has a surface
// of its own instead of becoming another paragraph of grey text.
export function Note({ children, tone = 'cyan' }) {
  const ground = { cyan: c.cyanTint, coral: c.coralTint, violet: c.violetTint, engaged: c.engagedTint };
  const edge = { cyan: c.cyan, coral: c.coral, violet: c.violet, engaged: c.engaged };
  return <View style={[styles.note, { backgroundColor: ground[tone] || c.cyanTint, borderColor: edge[tone] || c.cyan }]}>
    {children}
  </View>;
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  page: { padding: s.s5, paddingBottom: s.s7, maxWidth: 640, width: '100%', alignSelf: 'center' },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: s.s2 },
  brandWord: { fontFamily: f.displayHeavy, fontSize: 21, letterSpacing: -.7, color: c.text },
  brandWordAccent: { fontFamily: f.displayHeavy, fontSize: 21, letterSpacing: -.7, color: c.violetText },

  eyebrow: { fontFamily: f.semibold, color: c.text3, fontSize: 11, letterSpacing: 1.3, marginTop: s.s4, textTransform: 'uppercase' },
  title: { fontFamily: f.displayHeavy, color: c.text, fontSize: 32, lineHeight: 36, letterSpacing: -1.1, marginTop: s.s3, marginBottom: s.s5 },
  heading: { fontFamily: f.displayBold, color: c.text, fontSize: 21, lineHeight: 27, letterSpacing: -.4 },
  sectionTitle: { fontFamily: f.displayBold, color: c.text, fontSize: 17, letterSpacing: -.2, marginTop: s.s5 },

  card: {
    backgroundColor: c.surface, borderColor: c.borderSoft, borderWidth: 1,
    borderRadius: r.lg, padding: s.s5, marginTop: s.s4, gap: s.s3,
  },

  statBlock: { marginTop: s.s1, gap: 2 },
  stat: { fontFamily: f.displayHeavy, fontSize: 46, lineHeight: 50, letterSpacing: -1.8 },
  statLabel: { fontFamily: f.medium, fontSize: 13, lineHeight: 19, color: c.text3Up },

  note: {
    borderWidth: 1, borderRadius: r.md,
    paddingVertical: s.s3, paddingHorizontal: s.s4, gap: s.s2, marginTop: s.s2,
  },
  noteText: { fontFamily: f.body, fontSize: 14, lineHeight: 21, color: c.text2 },

  timeline: { flexDirection: 'row', overflow: 'hidden', borderRadius: r.sm, width: '100%', borderWidth: 1, borderColor: c.border, backgroundColor: c.inset },
  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 11, height: 11, borderRadius: 3 },

  body: { fontFamily: f.body, fontSize: 16, lineHeight: 24, color: c.text2 },
  caption: { fontFamily: f.body, fontSize: 13, lineHeight: 20, color: c.text3Up },
  label: { fontFamily: f.semibold, fontSize: 15, color: c.text, marginTop: s.s2 },
  error: { fontFamily: f.medium, color: c.faultText, fontSize: 14, lineHeight: 21, backgroundColor: c.faultTint, borderColor: c.fault, borderWidth: 1, borderRadius: r.md, padding: s.s3 },
  footer: { fontFamily: f.body, color: c.text3, fontSize: 12, lineHeight: 19, marginTop: s.s6, paddingTop: s.s5, borderTopWidth: 1, borderTopColor: c.borderSoft },

  input: {
    fontFamily: f.body, borderWidth: 1, borderColor: c.border, borderRadius: r.sm,
    color: c.text, padding: 13, fontSize: 16, backgroundColor: c.inset, minHeight: 48,
  },
  row: { flexDirection: 'row', gap: s.s2, flexWrap: 'wrap' },
  tabRow: { flexDirection: 'row', gap: s.s2, flexWrap: 'wrap', marginBottom: s.s2 },
  button: {
    borderWidth: 1, borderColor: c.cobaltFill, backgroundColor: c.cobaltFill,
    borderRadius: r.sm, paddingHorizontal: 17, paddingVertical: 13,
    minHeight: 48, justifyContent: 'center', alignItems: 'center',
  },
  secondary: { backgroundColor: 'transparent', borderColor: c.border },
  buttonText: { fontFamily: f.semibold, color: c.onAccent, fontSize: 15 },
});
