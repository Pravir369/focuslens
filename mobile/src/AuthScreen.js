import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Card, styles } from './ui';
import { validatePassword } from './api';

export function AuthScreen({ session }) {
  const [mode, setMode] = useState('login'), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(''), [role, setRole] = useState('student'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    try {
      if (!email.trim() || !email.includes('@')) throw new Error('Enter your account email.');
      validatePassword(password);
      if (mode === 'signup' && !displayName.trim()) throw new Error('Enter your name.');
      setBusy(true); setError('');
      await session.authenticate(mode, { email: email.trim(), password, ...(mode === 'signup' ? { displayName: displayName.trim(), role } : {}) });
    } catch (failure) { setError(failure.message); }
    finally { setPassword(''); setBusy(false); }
  }
  return <Card>
    <Text style={styles.heading}>{mode === 'login' ? 'Welcome back.' : 'Start with an account.'}</Text>
    <Text style={styles.body}>Use the same FocusLens account as your laptop. Camera tracking stays there; this companion brings your progress with you.</Text>
    <Text style={styles.caption}>New here? Choose Create account below. This Expo Go version uses email and password; Google sign-in is not available here yet.</Text>
    <View style={styles.row}><Button secondary={mode !== 'login'} disabled={busy} onPress={() => { setMode('login'); setPassword(''); setError(''); }}>Sign in</Button>
      <Button secondary={mode !== 'signup'} disabled={busy} onPress={() => { setMode('signup'); setPassword(''); setError(''); }}>Create account</Button></View>
    {mode === 'signup' && <><Text style={styles.label}>Your name</Text><TextInput accessibilityLabel="Your name" testID="signup-name" editable={!busy} style={styles.input} value={displayName} onChangeText={setDisplayName} autoComplete="name" maxLength={100} /></>}
    <Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Email" testID="auth-email" editable={!busy} style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" maxLength={254} />
    <Text style={styles.label}>Password</Text><TextInput accessibilityLabel="Password" testID="auth-password" editable={!busy} style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} textContentType={mode === 'signup' ? 'newPassword' : 'password'} onSubmitEditing={submit} />
    {mode === 'signup' && <><Text style={styles.caption}>At least 8 characters; maximum 72 UTF-8 bytes.</Text><Text style={styles.label}>I’m a</Text><View style={styles.row}>
      <Button disabled={busy} secondary={role !== 'student'} onPress={() => setRole('student')}>Student</Button><Button disabled={busy} secondary={role !== 'parent'} onPress={() => setRole('parent')}>Parent</Button>
    </View></>}
    {Boolean(error) && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Button testID="auth-submit" disabled={busy} onPress={submit}>{busy ? 'Checking your account…' : mode === 'signup' ? 'Create my account' : 'Sign in to FocusLens'}</Button>
    <Text style={styles.caption}>Only your sign-in token is saved, in secure device storage. Your password is never saved by this app.</Text>
  </Card>;
}
