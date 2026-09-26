export const API_BASE = 'https://gofixo.mob13r.com/api';

export function getToken() {
  return localStorage.getItem('gofixo_token') || '';
}

export function setSession(token, user, role) {
  localStorage.setItem('gofixo_token', token);
  localStorage.setItem('gofixo_user', JSON.stringify(user));
  localStorage.setItem('gofixo_role', role);
}

export function clearSession() {
  localStorage.removeItem('gofixo_token');
  localStorage.removeItem('gofixo_user');
  localStorage.removeItem('gofixo_role');
}

export function getUser() {
  const raw = localStorage.getItem('gofixo_user');
  return raw ? JSON.parse(raw) : null;
}

export function getRole() {
  return localStorage.getItem('gofixo_role') || null;
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function apiPost(path, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${getToken()}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function apiPatch(path, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${getToken()}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function apiGet(path, auth = false) {
  const headers = {};
  if (auth) headers['Authorization'] = `Bearer ${getToken()}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  return handle(res);
}

export async function apiUpload(path, formData, auth = true) {
  const headers = {};
  if (auth) headers['Authorization'] = `Bearer ${getToken()}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });
  return handle(res);
}
