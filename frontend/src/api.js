import { supabase } from './supabase'

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function req(path, options = {}) {
  const token = await getToken()

  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Ошибка сервера')
  }
  return res.json()
}

export const api = {
  // ─── Profile ─────────────────────────────────────────────
  getProfile: () => req('/profile/'),

  updateProfile: (data) =>
    req('/profile/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // ─── Analyses ────────────────────────────────────────────
  createAnalysis: (formData) =>
    req('/analyses/', { method: 'POST', body: formData }),

  getAnalysis: (id) => req(`/analyses/${id}`),

  // userId — только для суперадмина: uuid пользователя или 'all'.
  // Обычный пользователь параметр не передаёт (и бэкенд его игнорирует).
  listAnalyses: (userId) =>
    req(`/analyses/${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`),

  deleteAnalysis: (id) => req(`/analyses/${id}`, { method: 'DELETE' }),

  // ─── Admin (суперадмин) ──────────────────────────────────
  // 200 + список профилей — ты админ; 403 — обычный пользователь.
  adminListUsers: () => req('/analyses/admin/users'),
}
