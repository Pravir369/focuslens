export const DEFAULT_API_URL = 'https://focuslens-accounts.onrender.com';
export function validateApiUrl(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Use an HTTPS backend address without credentials or a path.');
  return url.origin;
}
export const API_URL = validateApiUrl(typeof document === 'object' ? window.location.origin : (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL));
