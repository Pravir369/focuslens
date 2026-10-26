import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { AuthSession } from './src/session';
import { secureSessionStorage } from './src/secure-session';
import { AuthScreen } from './src/AuthScreen';
import { Button, Card, styles, tokens } from './src/ui';
import { BrandMark } from './src/BrandMark';
import { StudentArea } from './src/StudentArea';
import { ParentArea } from './src/ParentArea';
import { NotificationProvider } from './src/NotificationSettings';
const session = new AuthSession(secureSessionStorage);

export default function App() {
  const [auth, setAuth] = useState(session.state);
  // Real per-weight faces, bundled with the app — no network font fetch.
  const [fontsLoaded, fontError] = useFonts({
    'Manrope-Bold': require('./assets/fonts/Manrope-Bold.ttf'),
    'Manrope-ExtraBold': require('./assets/fonts/Manrope-ExtraBold.ttf'),
    'Inter-Regular': require('./assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'),
  });
  const scroll = useRef(null), scrollToTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  useEffect(() => { const unsubscribe = session.subscribe(setAuth); void session.restore(); return unsubscribe; }, []);
  // If a face fails to register, fall through to the system stack rather than
  // holding the app on a blank screen.
  const typeReady = fontsLoaded || Boolean(fontError);
  return <SafeAreaProvider><SafeAreaView style={styles.safe}><StatusBar style="light" />
    {!typeReady ? <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={tokens.color.cyan} /></View>
      : <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow} accessible accessibilityRole="header" accessibilityLabel="FocusLens">
          <BrandMark size={28} />
          <Text style={styles.brandWord}>Focus<Text style={styles.brandWordAccent}>Lens</Text></Text>
        </View>
        <Text style={styles.eyebrow}>Companion</Text>
        <Text style={styles.title}>A place for your progress.</Text>
        {auth.phase === 'loading' ? <Card accent="quiet"><ActivityIndicator color={tokens.color.cyan} /><Text style={styles.body}>Checking your secure sign-in…</Text></Card>
          : auth.phase === 'error' ? <Card accent="coral"><Text accessibilityRole="alert" style={styles.error}>{auth.error}</Text><Button onPress={() => session.restore()}>Retry connection</Button><Button secondary onPress={() => session.logout()}>Sign out on this device</Button></Card>
          : auth.phase === 'signedOut' ? <>{Boolean(auth.error) && <Text style={styles.error}>{auth.error}</Text>}<AuthScreen session={session} /></>
          : <NotificationProvider key={auth.user.id} session={session}>{auth.user.role === 'student' ? <StudentArea session={session} user={auth.user} onNavigate={scrollToTop} />
          : <ParentArea session={session} user={auth.user} onNavigate={scrollToTop} />}</NotificationProvider>}
        <Text style={styles.footer}>Camera images stay on your laptop. This app does not access your camera or microphone.</Text>
      </ScrollView>
    </KeyboardAvoidingView>}
  </SafeAreaView></SafeAreaProvider>;
}
