export const API_BASE = 'https://gofixo.mob13r.com/api';

function getAdminKey() {
  return sessionStorage.getItem('gofixo_admin_key') || '';
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
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
  if (!res.ok) {
    if (res.status === 401) throw new Error('Admin key incorrect — please log in again');
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}
