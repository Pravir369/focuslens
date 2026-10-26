import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

const KEY = 'focuslens.expo.notification.v1';
const safeError = message => Object.assign(new Error('Notification setup unavailable.'), { safeMessage: message });
export const pushStorage = {
  async get() { const value = await SecureStore.getItemAsync(KEY); return value ? JSON.parse(value) : null; },
  set: value => SecureStore.setItemAsync(KEY, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
export const pushDevice = {
  async register() {
    if (!['ios', 'android'].includes(Platform.OS)) throw safeError('Open the native app on your phone to connect Expo notifications.');
    if (!Device.isDevice) throw safeError('Use your real iPhone or Android phone for the push test. A simulator cannot verify delivery.');
    if (Platform.OS === 'android' && Constants.appOwnership === 'expo') throw safeError('Android remote notifications require a development build; Expo Go does not support them.');
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    if (!projectId) throw safeError('This app is missing its Expo project configuration.');
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('focuslens', { name: 'FocusLens tests', importance: Notifications.AndroidImportance.DEFAULT });
    let permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) permissions = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    if (!permissions.granted) throw safeError('Notifications are off. Allow notifications for this app in iPhone or Android Settings, then retry.');
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      return { token: result.data, platform: Platform.OS };
    } catch {
      throw safeError('This runtime could not register remote notifications. Check your internet connection and Expo sign-in. If Expo Go rejects push, a development build is required; the free Home Screen app is still available.');
    }
  },
};
export function installForegroundHandler() {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
}
export function onTestReceived(callback) {
  const listener = Notifications.addNotificationReceivedListener(notification => {
    const data = notification.request.content.data;
    if (data?.kind === 'test' && typeof data.testId === 'string') callback(data.testId);
  });
  return () => listener.remove();
}
