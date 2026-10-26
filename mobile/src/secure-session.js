import * as SecureStore from 'expo-secure-store';
const TOKEN_KEY = 'focuslens.account.jwt.v1';
export const secureSessionStorage = {
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY),
  setToken: token => SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  clearToken: () => SecureStore.deleteItemAsync(TOKEN_KEY),
};
