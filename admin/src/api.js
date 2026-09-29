export const API_BASE = 'https://gofixo.mob13r.com/api';

function getAdminKey() {
  return sessionStorage.getItem('gofixo_admin_key') || '';
}

// A wrong/missing admin key sends the admin back to the login screen
function handleUnauthorized() {
  sessionStorage.removeItem('gofixo_admin_key');
  window.location.reload();
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-admin-key': getAdminKey() },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Admin key incorrect — please log in again');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiPatch(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': getAdminKey(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Admin key incorrect — please log in again');
  }
  if (!res.ok) throw new Error(data.error || `API error: ${res.status}`);
  return data;
}
