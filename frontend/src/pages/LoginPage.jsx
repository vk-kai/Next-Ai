import { useEffect, useState } from 'react'
import { fetchAuthStatus, login, registerAdmin, saveSession } from '../api'

const EMPTY_FORM = { username: '', password: '', confirm: '' }

export default function LoginPage({ onAuthed }) {
  const [checking, setChecking] = useState(true)
  const [statusError, setStatusError] = useState(null)
  const [hasUsers, setHasUsers] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // 查询系统是否已初始化账号：has_users=false 时展示"初始化管理员"表单
  useEffect(() => {
    let cancelled = false
    setChecking(true)
    setStatusError(null)
    ;(async () => {
      try {
        const status = await fetchAuthStatus()
        if (!cancelled) setHasUsers(!!status?.has_users)
      } catch (err) {
        if (!cancelled) setStatusError(err.message || '无法获取系统状态')
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const isInit = !checking && !hasUsers
  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    const username = form.username.trim()
    if (!username) return setError('请输入用户名')
    if (!form.password) return setError('请输入密码')
    if (isInit) {
      if (!form.confirm) return setError('请再次输入密码')
      if (form.password !== form.confirm) return setError('两次输入的密码不一致')
    }

    setSubmitting(true)
    try {
      const result = isInit
        ? await registerAdmin(username, form.password)
        : await login(username, form.password)
      saveSession(result.token, result.username)
      onAuthed?.(result.username)
    } catch (err) {
      setError(err.message || '操作失败，请重试')
      // 若系统刚好被他人完成初始化，刷新状态切回登录模式
      if (isInit) {
        fetchAuthStatus()
          .then((status) => setHasUsers(!!status?.has_users))
          .catch(() => {})
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-dot" />
          Next-AI
        </div>

        <h1 className="login-title">
          {checking ? '欢迎使用 Next-AI' : isInit ? '初始化管理员账号' : '登录'}
        </h1>
        <p className="login-subtitle">
          {checking
            ? '正在检查系统状态…'
            : isInit
              ? '首次使用，请创建管理员账号'
              : '知识库驱动的智能体工作台'}
        </p>

        {statusError ? (
          <div className="login-status-error">
            <p className="state-text error-text">无法连接服务器：{statusError}</p>
            <button className="btn btn-outline" onClick={() => setReloadKey((k) => k + 1)}>
              重试
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <span className="form-label">用户名</span>
              <input
                className="input"
                value={form.username}
                onChange={(e) => setField('username', e.target.value)}
                placeholder="用户名"
                autoComplete="username"
                autoFocus
              />
            </div>
            <div className="form-field">
              <span className="form-label">密码</span>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                placeholder="密码"
                autoComplete={isInit ? 'new-password' : 'current-password'}
              />
            </div>
            {isInit && (
              <div className="form-field">
                <span className="form-label">确认密码</span>
                <input
                  className="input"
                  type="password"
                  value={form.confirm}
                  onChange={(e) => setField('confirm', e.target.value)}
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && <div className="form-error">⚠️ {error}</div>}

            <button type="submit" className="btn btn-primary login-submit" disabled={submitting || checking}>
              {submitting ? (
                <>
                  <span className="spinner" /> {isInit ? '创建中…' : '登录中…'}
                </>
              ) : isInit ? (
                '创建管理员账号'
              ) : (
                '登录'
              )}
            </button>
          </form>
        )}

        <p className="login-footer">Next-AI · 基于知识库的智能助手</p>
      </div>
    </div>
  )
}
