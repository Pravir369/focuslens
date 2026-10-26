// Free hosting can take over a minute to wake after inactivity. Keep one
// bounded request in flight; never automatically replay account-creation POSTs.
export const ACCOUNT_REQUEST_TIMEOUT_MS = 90000;
export const ACCOUNT_SLOW_NOTICE_MS = 10000;
export const ACCOUNT_SLOW_NOTICE = 'FocusLens is taking longer to respond. The service may be waking up; this can take about a minute. Please keep this page open.';

export async function readAccountJson(response) {
  try { return await response.json(); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('FocusLens is waking up or returned an unexpected response. Please wait a moment and try again. If you were creating an account, try signing in first.');
  }
}

export function authFailureMessage(failure, kind) {
  if (failure.name !== 'AbortError') return failure.message;
  return kind === 'signup'
    ? 'Account creation could not be confirmed after 90 seconds. The account may already exist. Wait a moment, then try Sign in with the same email and password before creating it again.'
    : 'Sign-in could not be confirmed after 90 seconds. The service may still be waking up. Wait a moment, then try again.';
}
