const BASE = '/api'

/* ================= 会话凭证 ================= */

const TOKEN_KEY = 'nextai_token'
const USERNAME_KEY = 'nextai_username'

// token 失效时派发的全局事件，App 监听后切回登录页
export const UNAUTHORIZED_EVENT = 'nextai:unauthorized'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function getStoredUsername() {
  return localStorage.getItem(USERNAME_KEY) || ''
}

export function saveSession(token, username) {
  localStorage.setItem(TOKEN_KEY, token || '')
  localStorage.setItem(USERNAME_KEY, username || '')
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USERNAME_KEY)
}

function handleUnauthorized() {
  clearSession()
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
}

async function parseErrorResponse(res) {
  let message = `请求失败（HTTP ${res.status}）`
  try {
    const data = await res.json()
    if (data && data.detail) {
      message = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    }
  } catch (_) {
    // 响应体不是 JSON 时使用默认错误信息
  }
  return new Error(message)
}

/**
 * 统一请求封装：
 * - 非 public 接口自动附加 Authorization: Bearer <token>
 * - 收到 401 时清除本地凭证并派发 UNAUTHORIZED_EVENT，让应用回到登录页
 */
async function request(path, options = {}, { public: isPublic = false } = {}) {
  const headers = { ...(options.headers || {}) }
  let attachedToken = false
  if (!isPublic) {
    const token = getToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
      attachedToken = true
    }
  }

  let res
  try {
    res = await fetch(BASE + path, { ...options, headers })
  } catch (_) {
    throw new Error('无法连接服务器，请确认后端服务已启动')
  }

  if (res.status === 401 && (attachedToken || !isPublic)) {
    handleUnauthorized()
    throw new Error('登录已过期，请重新登录')
  }
  if (!res.ok) throw await parseErrorResponse(res)
  if (res.status === 204) return null
  return res.json()
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/* ================= 认证 ================= */

export function fetchAuthStatus() {
  return request('/auth/status', {}, { public: true })
}

export function login(username, password) {
  return request('/auth/login', jsonOptions('POST', { username, password }), { public: true })
}

export function registerAdmin(username, password) {
  return request('/auth/register', jsonOptions('POST', { username, password }), { public: true })
}

export function fetchMe() {
  return request('/auth/me')
}

export function changePassword(oldPassword, newPassword) {
  return request(
    '/auth/change-password',
    jsonOptions('POST', { old_password: oldPassword, new_password: newPassword })
  )
}

/* ================= 设置 ================= */

export function fetchSettings() {
  return request('/settings')
}

export function updateSettings(payload) {
  return request('/settings', jsonOptions('PUT', payload))
}

export function testSettings() {
  return request('/settings/test', { method: 'POST' })
}

/* ================= 对话（SSE 流式，POST + ReadableStream 手动解析） ================= */

function parseSseEvent(raw) {
  const dataLines = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return null
  try {
    return JSON.parse(dataLines.join('\n'))
  } catch (_) {
    return null
  }
}

export async function streamChat({ collection, messages, onSources, onDelta, onDone, onError }) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ collection, messages }),
    })
  } catch (_) {
    onError?.('无法连接服务器，请确认后端服务已启动')
    return
  }
  if (res.status === 401) {
    handleUnauthorized()
    onError?.('登录已过期，请重新登录')
    return
  }
  if (!res.ok || !res.body) {
    onError?.((await parseErrorResponse(res)).message)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const dispatch = (raw) => {
    const event = parseSseEvent(raw)
    if (!event) return
    if (event.type === 'sources') onSources?.(Array.isArray(event.sources) ? event.sources : [])
    else if (event.type === 'delta') onDelta?.(event.content || '')
    else if (event.type === 'done') onDone?.()
    else if (event.type === 'error') onError?.(event.message || '服务返回未知错误')
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        dispatch(buffer.slice(0, index))
        buffer = buffer.slice(index + 2)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) dispatch(buffer)
  } catch (_) {
    onError?.('连接中断，回答可能不完整')
  }
}

/* ================= 文件上传 ================= */

export async function uploadFiles(files, collection = 'default') {
  const formData = new FormData()
  for (const file of files) formData.append('files', file)
  formData.append('collection', collection)
  return request('/files/upload', { method: 'POST', body: formData })
}

/* ================= 知识库 ================= */

export function fetchCollections() {
  return request('/kb/collections')
}

export function updateCollection(name, description) {
  return request(`/kb/collections/${encodeURIComponent(name)}`, jsonOptions('PUT', { description }))
}

export function fetchDocuments(collection = 'default') {
  return request(`/kb/documents?collection=${encodeURIComponent(collection)}`)
}

export function deleteDocument(id) {
  return request(`/kb/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ================= 数据源 ================= */

export function fetchSources(collection = 'default') {
  return request(`/sources?collection=${encodeURIComponent(collection)}`)
}

export function createSource(payload) {
  return request('/sources', jsonOptions('POST', payload))
}

export function deleteSource(id) {
  return request(`/sources/${id}`, { method: 'DELETE' })
}

export function syncSource(id) {
  return request(`/sources/${id}/sync`, { method: 'POST' })
}

export function fetchSourceReports(id) {
  return request(`/sources/${id}/reports`)
}
