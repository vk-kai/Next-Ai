import { useCallback, useEffect, useRef, useState } from 'react'
import {
  UNAUTHORIZED_EVENT,
  clearSession,
  fetchMe,
  getStoredUsername,
  getToken,
} from './api'
import ChatPage from './pages/ChatPage'
import KnowledgePage from './pages/KnowledgePage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'

const NAV_ITEMS = [
  { key: 'chat', label: '对话', icon: '💬' },
  { key: 'knowledge', label: '知识库', icon: '📚' },
  { key: 'settings', label: '设置', icon: '⚙️' },
]

export default function App() {
  const [page, setPage] = useState('chat')
  // checking：校验本地 token 中 | guest：未登录 | authed：已登录
  const [authState, setAuthState] = useState('checking')
  const [username, setUsername] = useState('')
  const [toast, setToast] = useState(null)
  const timerRef = useRef(null)
  const authedRef = useRef(false)

  const showToast = useCallback((text, type = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ text, type, key: Date.now() })
    timerRef.current = setTimeout(() => setToast(null), 4500)
  }, [])

  // 启动时校验本地 token：有效则进入主界面，无效则清除并显示登录页
  useEffect(() => {
    if (!getToken()) {
      setAuthState('guest')
      return
    }
    let cancelled = false
    fetchMe()
      .then((me) => {
        if (cancelled) return
        authedRef.current = true
        setUsername(me?.username || getStoredUsername())
        setAuthState('authed')
      })
      .catch(() => {
        if (cancelled) return
        clearSession()
        setAuthState('guest')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // api 层收到 401 会清除凭证并派发事件，这里统一切回登录页
  useEffect(() => {
    const onUnauthorized = () => {
      if (authedRef.current) showToast('登录已过期，请重新登录', 'error')
      authedRef.current = false
      setUsername('')
      setPage('chat')
      setAuthState('guest')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [showToast])

  function handleAuthed(name) {
    authedRef.current = true
    setUsername(name || getStoredUsername())
    setPage('chat')
    setAuthState('authed')
  }

  function handleLogout() {
    clearSession()
    authedRef.current = false
    setUsername('')
    setPage('chat')
    setAuthState('guest')
  }

  if (authState === 'checking') {
    return (
      <div className="boot-screen">
        <span className="spinner spinner-dark" /> 正在加载…
      </div>
    )
  }

  if (authState === 'guest') {
    return <LoginPage onAuthed={handleAuthed} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-dot" />
            Next-AI
          </div>
          <nav className="nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`nav-item${page === item.key ? ' active' : ''}`}
                onClick={() => setPage(item.key)}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="topbar-user">
            <span className="user-chip" title={username}>
              <span>👤</span>
              <span className="user-name">{username || '用户'}</span>
            </span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {page === 'chat' && <ChatPage showToast={showToast} />}
        {page === 'knowledge' && <KnowledgePage showToast={showToast} />}
        {page === 'settings' && <SettingsPage showToast={showToast} username={username} />}
      </main>

      {toast && (
        <div key={toast.key} className={`toast toast-${toast.type}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
