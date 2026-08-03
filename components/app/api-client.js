'use client';

let refreshing = null;

async function raw(path, { method = 'GET', body } = {}) {
  return fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

/** Fetch wrapper with one-shot rotating-refresh retry on an expired session. */
export async function api(path, opts = {}) {
  let res = await raw(path, opts);

  if (res.status === 401 && !path.startsWith('/auth/')) {
    refreshing = refreshing || raw('/auth/refresh', { method: 'POST' }).finally(() => { refreshing = null; });
    const r = await refreshing;
    if (r.ok) res = await raw(path, opts);
  }

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (!res.ok) {
    const err = new Error(data?.error || 'Request failed (' + res.status + ')');
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p, body) => api(p, { method: 'DELETE', body });
