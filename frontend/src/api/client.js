// Tiny fetch wrapper. No axios — `fetch` covers everything we need.
// This branch has no auth, so there are no tokens to attach; every request
// goes straight to the Go backend through the gateway under /api.

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const error = new Error((data && data.error) || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  get:    (path)       => request(path),
  post:   (path, body) => request(path, { method: 'POST',  body }),
  patch:  (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path)       => request(path),
};
