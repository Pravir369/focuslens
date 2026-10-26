import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function Button({ children, onPress, secondary = false, disabled = false, testID }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} testID={testID} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && { opacity: .6 }]}>
    <Text style={[styles.buttonText, secondary && { color: '#28664e' }]}>{children}</Text>
  </Pressable>;
}
export function Card({ children }) { return <View style={styles.card}>{children}</View>; }
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f6f2' }, page: { padding: 24, paddingBottom: 48, maxWidth: 620, width: '100%', alignSelf: 'center' },
  eyebrow: { color: '#28664e', fontSize: 12, fontWeight: '800', letterSpacing: 1.6, marginTop: 18 }, title: { color: '#20332b', fontSize: 34, lineHeight: 39, fontWeight: '700', letterSpacing: -.9, marginVertical: 18 },
  card: { backgroundColor: '#fff', borderColor: '#d7e2d9', borderWidth: 1, borderRadius: 18, padding: 22, marginTop: 14, gap: 12 }, heading: { color: '#20332b', fontSize: 23, fontWeight: '700' },
  stat: { color: '#28664e', fontSize: 48, fontWeight: '700', letterSpacing: -1.5 }, sectionTitle: { color: '#20332b', fontSize: 19, fontWeight: '600', marginTop: 24 }, timeline: { flexDirection: 'row', overflow: 'hidden', borderRadius: 6, width: '100%' },
  body: { fontSize: 16, color: '#3f5549', lineHeight: 24 }, caption: { fontSize: 13, color: '#52645b', lineHeight: 20 }, label: { fontSize: 15, fontWeight: '600', color: '#20332b', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#8c9f92', borderRadius: 8, color: '#20332b', padding: 13, fontSize: 16, backgroundColor: '#fff', minHeight: 48 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' }, button: { borderWidth: 1, borderColor: '#28664e', backgroundColor: '#28664e', borderRadius: 9, paddingHorizontal: 17, paddingVertical: 13, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  secondary: { backgroundColor: '#fff' }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' }, error: { color: '#8a2828', fontSize: 14, lineHeight: 21 }, footer: { color: '#52645b', fontSize: 12, lineHeight: 19, marginTop: 28 },
});
