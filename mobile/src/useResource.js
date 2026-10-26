import { useEffect, useState } from 'react';

export function useResource(session, path) {
  const [attempt, setAttempt] = useState(0), [resource, setResource] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    const abort = new AbortController(); let current = true;
    setResource({ data: null, loading: true, error: '' });
    session.request(path, { signal: abort.signal }).then(data => {
      if (current) setResource({ data, loading: false, error: '' });
    }).catch(error => { if (current) setResource({ data: null, loading: false, error: error.message }); });
    return () => { current = false; abort.abort(); };
  }, [session, path, attempt]);
  return { ...resource, reload: () => setAttempt(value => value + 1) };
}
