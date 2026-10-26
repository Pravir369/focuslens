import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthSession } from './src/session';
import { secureSessionStorage } from './src/secure-session';
import { AuthScreen } from './src/AuthScreen';
import { Button, Card, styles } from './src/ui';
import { StudentArea } from './src/StudentArea';
import { ParentArea } from './src/ParentArea';
import { NotificationProvider } from './src/NotificationSettings';
const session = new AuthSession(secureSessionStorage);

export default function App() {
  const [auth, setAuth] = useState(session.state);
  const scroll = useRef(null), scrollToTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  useEffect(() => { const unsubscribe = session.subscribe(setAuth); void session.restore(); return unsubscribe; }, []);
  return <SafeAreaProvider><SafeAreaView style={styles.safe}><StatusBar style="dark" />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>FOCUSLENS · COMPANION</Text><Text style={styles.title}>A place for your progress.</Text>
        {auth.phase === 'loading' ? <Card><ActivityIndicator color="#28664e" /><Text style={styles.body}>Checking your secure sign-in…</Text></Card>
          : auth.phase === 'error' ? <Card><Text accessibilityRole="alert" style={styles.error}>{auth.error}</Text><Button onPress={() => session.restore()}>Retry connection</Button><Button secondary onPress={() => session.logout()}>Sign out on this device</Button></Card>
          : auth.phase === 'signedOut' ? <>{Boolean(auth.error) && <Text style={styles.error}>{auth.error}</Text>}<AuthScreen session={session} /></>
          : <NotificationProvider key={auth.user.id} session={session}>{auth.user.role === 'student' ? <StudentArea session={session} user={auth.user} onNavigate={scrollToTop} />
          : <ParentArea session={session} user={auth.user} onNavigate={scrollToTop} />}</NotificationProvider>}
        <Text style={styles.footer}>Camera images stay on your laptop. This app does not access your camera or microphone.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView></SafeAreaProvider>;
}
