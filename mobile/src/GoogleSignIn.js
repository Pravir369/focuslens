import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { GoogleBrowserLogin } from './google-browser';
import { Button, styles } from './ui';

async function makeProof() {
  if (!['ios','android'].includes(Platform.OS)) throw Error('Use the phone app.');
  const bytes = await Crypto.getRandomBytesAsync(32);
  const verifier = Array.from(bytes, byte=>byte.toString(16).padStart(2,'0')).join('');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,verifier,{encoding:Crypto.CryptoEncoding.BASE64});
  return {verifier,challenge:digest.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
}
export function GoogleSignIn({session, role, disabled, onPendingChange}) {
  const [flow] = useState(()=>new GoogleBrowserLogin(session,{makeProof,openBrowser:url=>WebBrowser.openBrowserAsync(url,{dismissButtonStyle:'done'})}));
  const [state,setState] = useState(flow.state);
  useEffect(()=>{ const unsubscribe=flow.subscribe(setState); return ()=>{unsubscribe();flow.dispose();}; },[flow]);
  useEffect(()=>{onPendingChange(state.busy || state.phase !== 'idle');},[state.busy,state.phase,onPendingChange]);
  return <View style={{gap:12}}>
    {state.phase === 'idle' ? <><Button testID="google-signin" secondary disabled={disabled || state.busy} onPress={()=>flow.start(role)}>{state.busy ? 'Opening Google…' : 'Continue with Google'}</Button>
      <Text style={styles.caption}>Google opens in your phone’s browser. New accounts use the selected account type; existing accounts keep theirs.</Text></>
      : <><Text style={styles.heading}>Google sign-in</Text><Text style={styles.caption}>Match this code in the browser: {state.code}</Text>
        <Text style={styles.body}>{state.message}</Text>
        {state.phase === 'ready' ? <><Text style={styles.body}>{state.user.displayName}</Text><Text style={styles.body}>{state.user.email}</Text><Text style={styles.caption}>{state.user.role === 'parent' ? 'Parent' : 'Student'} account. Continue only if this is your Google account.</Text>
          <Button testID="google-confirm" disabled={state.busy} onPress={()=>flow.confirm()}>Continue as {state.user.email}</Button></>
          : <><Button secondary disabled={state.busy} onPress={()=>flow.reopen()}>Reopen Google sign-in</Button><Button secondary disabled={state.busy} onPress={()=>flow.check()}>Check Google sign-in</Button></>}
        <Button secondary disabled={state.busy} onPress={()=>flow.cancel()}>Cancel Google sign-in</Button></>}
    {Boolean(state.error) && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
  </View>;
}
