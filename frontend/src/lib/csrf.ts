let csrfTokenCache = '';
let csrfTokenPromise: Promise<string> | null = null;

export async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && csrfTokenCache) {
    return csrfTokenCache;
  }
  if (!forceRefresh && csrfTokenPromise) {
    return csrfTokenPromise;
  }

  csrfTokenPromise = (async () => {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch('/api/auth/csrf-token', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'same-origin',
        });
        if (!res.ok) {
          throw new Error(`CSRF token request failed (${res.status})`);
        }
        const data = await res.json();
        const token = String(data?.csrfToken ?? '').trim();
        if (!token) {
          throw new Error('CSRF token missing in response');
        }
        csrfTokenCache = token;
        return token;
      } catch (err) {
        if (attempt === maxAttempts) {
          console.warn('CSRF token bootstrap failed; continuing without token for this request.', err);
          return '';
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
    return '';
  })().finally(() => {
    csrfTokenPromise = null;
  });

  return csrfTokenPromise;
}

export function clearCsrfTokenCache(): void {
  csrfTokenCache = '';
  csrfTokenPromise = null;
}
