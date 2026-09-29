import { useEffect, useState } from 'react'
import { changePassword, fetchSettings, testSettings, updateSettings } from '../api'

function Field({ label, hint, full, children }) {
  return (
    <div className={`form-field${full ? ' full' : ''}`}>
      <span className="form-label">
        {label}
        {hint && <span className="label-hint">（{hint}）</span>}
      </span>
      {children}
    </div>
  )
}

function TestResult({ label, result }) {
  if (!result) return null
  return (
    <div className={`test-result ${result.ok ? 'test-ok' : 'test-fail'}`}>
      <span className="test-label">
        {result.ok ? '✓' : '✗'} {label}：
      </span>
      <span>{result.message || (result.ok ? '连接正常' : '连接失败')}</span>
    </div>
  )
}

function ServiceForm({ title, icon, baseUrl, model, apiKey, hasKey, onChange }) {
  return (
    <div className="model-group">
      <div className="model-group-title">
        <span>{icon}</span>
        {title}
      </div>
      <div className="form-grid">
        <Field label="Base URL">
          <input
            className="input"
            value={baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </Field>
        <Field label="模型">
          <input
            className="input"
            value={model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="模型名称"
          />
        </Field>
        <Field label="API Key" full hint={hasKey ? '已配置，留空保持不变' : null}>
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder={hasKey ? '已配置，留空保持不变' : '未配置，请输入 API Key'}
            autoComplete="new-password"
          />
        </Field>
      </div>
    </div>
  )
}

const EMPTY_PWD = { old: '', next: '', confirm: '' }

export default function SettingsPage({ showToast, username }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  /* ---------- 智能体 ---------- */
  const [agentName, setAgentName] = useState('')
  const [persona, setPersona] = useState('')
  const [customized, setCustomized] = useState(false)

  /* ---------- 模型服务 ---------- */
  const [llm, setLlm] = useState({ baseUrl: '', apiKey: '', model: '' })
  const [hasLlmKey, setHasLlmKey] = useState(false)
  const [embedding, setEmbedding] = useState({ baseUrl: '', apiKey: '', model: '' })
  const [hasEmbKey, setHasEmbKey] = useState(false)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState(null)

  /* ---------- 账号安全 ---------- */
  const [pwdForm, setPwdForm] = useState(EMPTY_PWD)
  const [pwdError, setPwdError] = useState(null)
  const [pwdSuccess, setPwdSuccess] = useState(null)
  const [pwdSaving, setPwdSaving] = useState(false)

  function applySettings(data) {
    const agent = data?.agent || {}
    const llmData = data?.llm || {}
    const embData = data?.embedding || {}
    setAgentName(agent.name || '')
    setPersona(agent.persona || '')
    setCustomized(!!data?.customized)
    setLlm({ baseUrl: llmData.base_url || '', apiKey: '', model: llmData.model || '' })
    setHasLlmKey(!!llmData.has_api_key)
    setEmbedding({ baseUrl: embData.base_url || '', apiKey: '', model: embData.model || '' })
    setHasEmbKey(!!embData.has_api_key)
  }

  // 进入页面时加载当前配置
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchSettings()
        if (!cancelled) applySettings(data)
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      // api_key 传空字符串表示"保持不变"，直接透传输入框内容
      const data = await updateSettings({
        agent: { name: agentName.trim(), persona },
        llm: { base_url: llm.baseUrl.trim(), api_key: llm.apiKey, model: llm.model.trim() },
        embedding: {
          base_url: embedding.baseUrl.trim(),
          api_key: embedding.apiKey,
          model: embedding.model.trim(),
        },
      })
      applySettings(data)
      setTestResults(null)
      showToast('配置已保存')
    } catch (err) {
      showToast(err.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (testing) return
    setTesting(true)
    setTestResults(null)
    try {
      setTestResults(await testSettings())
    } catch (err) {
      showToast(err.message || '测试请求失败', 'error')
    } finally {
      setTesting(false)
    }
  }

  function setPwdField(key, value) {
    setPwdForm((f) => ({ ...f, [key]: value }))
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwdError(null)
    setPwdSuccess(null)
    if (!pwdForm.old) return setPwdError('请输入旧密码')
    if (!pwdForm.next) return setPwdError('请输入新密码')
    if (pwdForm.next !== pwdForm.confirm) return setPwdError('两次输入的新密码不一致')

    setPwdSaving(true)
    try {
      await changePassword(pwdForm.old, pwdForm.next)
      setPwdForm(EMPTY_PWD)
      setPwdSuccess('密码修改成功，下次登录请使用新密码')
      showToast('密码修改成功')
    } catch (err) {
      setPwdError(err.message || '修改失败，请重试')
    } finally {
      setPwdSaving(false)
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">设置</h1>
            <p className="page-subtitle">配置智能体人设、模型服务与账号安全</p>
          </div>
        </div>

        {loading ? (
          <p className="state-text">加载配置中…</p>
        ) : loadError ? (
          <p className="state-text error-text">加载失败：{loadError}</p>
        ) : (
          <>
            <form onSubmit={handleSave} noValidate>
              {/* ================ 智能体 ================ */}
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">智能体</h2>
                  {customized && <span className="badge badge-updated">已自定义</span>}
                </div>
                <p className="panel-desc">定义智能体的身份与回答风格，保存后作用于所有对话</p>
                <div className="form-grid">
                  <Field label="名称">
                    <input
                      className="input"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="如：Next-AI"
                    />
                  </Field>
                  <Field label="人设 / 系统提示词" full>
                    <textarea
                      className="textarea"
                      rows={4}
                      value={persona}
                      onChange={(e) => setPersona(e.target.value)}
                      placeholder="告诉智能体它的角色和回答风格，将作用于所有对话，例如：你是新闻网站的知识助手，回答简洁、专业，只依据资料作答"
                    />
                  </Field>
                </div>
              </section>

              {/* ================ 模型服务 ================ */}
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title">模型服务</h2>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={testing}
                    onClick={handleTest}
                  >
                    {testing ? (
                      <>
                        <span className="spinner spinner-dark" /> 测试中…
                      </>
                    ) : (
                      '测试连接'
                    )}
                  </button>
                </div>
                <p className="panel-desc">配置大语言模型与向量模型服务；API Key 留空表示保持不变</p>

                <ServiceForm
                  title="LLM · 对话模型"
                  icon="💬"
                  baseUrl={llm.baseUrl}
                  model={llm.model}
                  apiKey={llm.apiKey}
                  hasKey={hasLlmKey}
                  onChange={(patch) => setLlm((s) => ({ ...s, ...patch }))}
                />
                <ServiceForm
                  title="Embedding · 向量模型"
                  icon="🧩"
                  baseUrl={embedding.baseUrl}
                  model={embedding.model}
                  apiKey={embedding.apiKey}
                  hasKey={hasEmbKey}
                  onChange={(patch) => setEmbedding((s) => ({ ...s, ...patch }))}
                />

                {testResults && (
                  <div className="test-grid">
                    <TestResult label="LLM" result={testResults.llm} />
                    <TestResult label="Embedding" result={testResults.embedding} />
                  </div>
                )}

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? (
                      <>
                        <span className="spinner" /> 保存中…
                      </>
                    ) : (
                      '保存配置'
                    )}
                  </button>
                </div>
              </section>
            </form>

            {/* ================ 账号安全 ================ */}
            <section className="panel">
              <h2 className="panel-title">账号安全</h2>
              <p className="panel-desc">
                修改当前账号{username ? `（${username}）` : ''}的登录密码
              </p>
              <form onSubmit={handleChangePassword} noValidate>
                <div className="form-grid">
                  <Field label="旧密码" full>
                    <input
                      className="input"
                      type="password"
                      value={pwdForm.old}
                      onChange={(e) => setPwdField('old', e.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="新密码" full>
                    <input
                      className="input"
                      type="password"
                      value={pwdForm.next}
                      onChange={(e) => setPwdField('next', e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="确认新密码" full>
                    <input
                      className="input"
                      type="password"
                      value={pwdForm.confirm}
                      onChange={(e) => setPwdField('confirm', e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>

                {pwdError && <div className="form-error">⚠️ {pwdError}</div>}
                {pwdSuccess && <div className="form-success">✓ {pwdSuccess}</div>}

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={pwdSaving}>
                    {pwdSaving ? (
                      <>
                        <span className="spinner" /> 修改中…
                      </>
                    ) : (
                      '修改密码'
                    )}
                  </button>
                </div>
              </form>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
