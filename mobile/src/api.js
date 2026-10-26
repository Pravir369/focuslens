import { API_URL, validateApiUrl } from './config.js';

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}
export class ApiClient {
  constructor({ baseUrl = API_URL, fetcher = (...args) => fetch(...args), timeoutMs = 65000 } = {}) {
    this.baseUrl = validateApiUrl(baseUrl); this.fetcher = fetcher; this.timeoutMs = timeoutMs;
  }
  async request(path, { method = 'GET', body, token, signal } = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || new URL(path, this.baseUrl).origin !== this.baseUrl) throw new ApiError('Invalid account request.');
    const abort = new AbortController(), relay = () => abort.abort();
    signal?.addEventListener('abort', relay, { once: true }); if (signal?.aborted) abort.abort();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.baseUrl + path, {
        method, credentials: 'omit', redirect: 'error', signal: abort.signal,
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let data;
      try { data = await response.json(); } catch { throw new ApiError('FocusLens is waking up or returned an unexpected response. Please retry.', response.status); }
      if (!response.ok) throw new ApiError(response.status === 401 ? 'Your sign-in expired. Please sign in again.' : (data.error || 'The request could not be completed.'), response.status);
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.name === 'AbortError' ? 'The connection timed out. The service may be waking up; please retry.' : 'Could not reach FocusLens. Check your connection and try again.');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', relay); }
  }
}
export function validatePassword(password) {
  if (typeof password !== 'string' || Array.from(password).length < 8) throw new Error('Use a password with at least 8 characters.');
  let bytes = 0;
  for (const character of password) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw new Error('Enter a valid password.');
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  if (bytes > 72) throw new Error('Your password must fit within 72 UTF-8 bytes. Choose a shorter password.');
}
