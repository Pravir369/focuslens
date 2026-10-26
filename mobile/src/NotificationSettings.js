import React, { createContext, useContext, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Note, styles } from './ui';
import { PushRegistration } from './push-registration';
import { installForegroundHandler, onTestReceived, pushDevice, pushStorage } from './native-notifications';

const Context = createContext(null);
const statusText = { sending: 'Sending to Expo…', accepted: 'Expo accepted the test. Check the phone for actual arrival.',
  providerAccepted: 'Apple or Google accepted the test. This still does not prove arrival on the phone.', receiptPending: 'The provider receipt is not available yet.', failed: 'The test could not be confirmed.' };

export function NotificationProvider({ session, children }) {
  const [controller] = useState(() => new PushRegistration(session, pushDevice, pushStorage));
  const [state, setState] = useState(controller.state), [received, setReceived] = useState(false), [logoutFailed, setLogoutFailed] = useState(false);
  useEffect(() => {
    installForegroundHandler(); const unsubscribe = controller.subscribe(setState); void controller.restore();
    const remove = onTestReceived(testId => { if (controller.state.job?.jobId === testId) setReceived(true); });
    return () => { unsubscribe(); remove(); controller.dispose(); };
  }, [controller]);
  async function logout() {
    setLogoutFailed(false);
    if (await controller.disconnect()) await session.logout(); else setLogoutFailed(true);
  }
  return <Context.Provider value={{ controller, state, received, setReceived, logout, logoutFailed, session }}>{children}</Context.Provider>;
}
export function NotificationSettings() {
  const value = useContext(Context);
  if (!value) return null;
  const { controller, state, received, setReceived, logout, logoutFailed, session } = value;
  return <><Card accent="cyan"><Text style={styles.heading}>Phone notifications</Text>
    <Text style={styles.body}>Connect this phone to test delivery. This checkpoint sends only a test you request; study alerts are not connected yet.</Text>
    <Text style={styles.caption}>A device token is saved securely and registered to your signed-in account. Tests contain no study details. Your phone settings control banners and sounds.</Text>
    {Boolean(state.error) && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {Boolean(state.message) && <Note tone="cyan"><Text style={styles.noteText}>{state.message}</Text></Note>}
    <Button disabled={state.busy} onPress={() => controller.connect()}>{state.busy ? 'Working…' : state.connected ? 'Refresh notification connection' : 'Connect notifications'}</Button>
    {state.connected && <><Button secondary disabled={state.busy} onPress={() => { setReceived(false); void controller.test(); }}>Send test notification</Button>
      <Button secondary disabled={state.busy} onPress={() => controller.disconnect()}>Disconnect notifications</Button></>}
    {state.job && <><Text style={styles.caption}>{statusText[state.job.status] || 'Check the phone for your test.'}</Text><Button secondary disabled={state.busy} onPress={() => controller.check()}>Check test status</Button></>}
    {received && <Note tone="engaged"><Text accessibilityRole="alert" style={styles.noteText}>A matching test notification arrived while FocusLens was open.</Text></Note>}
    <Text style={styles.caption}>For the background test, send another test after one minute and immediately return to the phone’s Home Screen. Check for the notification there.</Text>
  </Card><Card accent="quiet"><Button secondary disabled={state.busy} onPress={logout}>Sign out on this device</Button>
    {logoutFailed && <><Text style={styles.error}>Notification cleanup did not finish. Retry sign-out online, or sign out anyway to clear secure account access.</Text><Button secondary disabled={state.busy} onPress={() => session.logout()}>Sign out anyway</Button></>}
  </Card></>;
}
