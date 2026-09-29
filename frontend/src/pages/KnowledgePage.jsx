import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSource,
  deleteDocument,
  deleteSource,
  fetchCollections,
  fetchDocuments,
  fetchSourceReports,
  fetchSources,
  syncSource,
  updateCollection,
  uploadFiles,
} from '../api'
import FileUpload from '../components/FileUpload'

const COLLECTION = 'default'

const TABS = [
  { key: 'files', label: '文件管理' },
  { key: 'sources', label: '数据源' },
  { key: 'overview', label: '概览' },
]

const DOC_SOURCE_LABEL = {
  file: '文件上传',
  rest_api: '接口抓取',
  database: '数据库查询',
  digest: '自动摘要',
}

const UPLOAD_STATUS_LABEL = { new: '新增', updated: '更新', skipped: '跳过' }

const SOURCE_TYPE_LABEL = { rest_api: '接口抓取', database: '数据库查询' }

const EMPTY_FORM = {
  name: '',
  type: 'rest_api',
  schedule: '',
  url: '',
  method: 'GET',
  items_path: '',
  id_field: '',
  updated_field: '',
  content_fields: '',
  headers: '',
  params: '',
  dsn: '',
  query: '',
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

function splitList(text) {
  return String(text || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseJsonField(text, label) {
  if (!text.trim()) return null
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    throw new Error('not an object')
  } catch (_) {
    throw new Error(`${label} 不是合法的 JSON 对象，请检查格式`)
  }
}

function statsSummary(stats) {
  if (!stats) return '暂无统计'
  return `抓取 ${stats.fetched ?? 0} 条 · 新增 ${stats.new ?? 0} · 更新 ${stats.updated ?? 0} · 跳过 ${stats.skipped ?? 0} · 生成 ${stats.chunks ?? 0} 个知识块`
}

function Field({ label, required, full, children }) {
  return (
    <div className={`form-field${full ? ' full' : ''}`}>
      <span className="form-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      {children}
    </div>
  )
}

/* ================= 单个数据源条目 ================= */

function SourceItem({ source, showToast, onChanged }) {
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [reports, setReports] = useState(null)
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportsError, setReportsError] = useState(null)

  async function loadReports() {
    setReportsLoading(true)
    setReportsError(null)
    try {
      setReports(await fetchSourceReports(source.id))
    } catch (err) {
      setReportsError(err.message)
    } finally {
      setReportsLoading(false)
    }
  }

  function toggleReports() {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (reports === null) loadReports()
  }

  async function handleSync() {
    if (syncing) return
    setSyncing(true)
    try {
      const result = await syncSource(source.id)
      const report = result?.report
      if (report?.status === 'success') {
        showToast(`「${source.name}」同步成功：${statsSummary(report.stats)}`)
      } else {
        showToast(`「${source.name}」同步失败：${report?.error || '未知错误'}`, 'error')
      }
      onChanged?.()
      if (expanded) loadReports()
    } catch (err) {
      showToast(err.message || '同步请求失败', 'error')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`确定删除数据源「${source.name}」吗？`)) return
    try {
      await deleteSource(source.id)
      showToast(`数据源「${source.name}」已删除`)
      onChanged?.()
    } catch (err) {
      showToast(err.message || '删除失败', 'error')
    }
  }

  const config = source.config || {}
  const endpoint = source.type === 'rest_api' ? config.url : config.dsn

  return (
    <div className="source-item">
      <div className="source-head">
        <span className="source-name">{source.name}</span>
        <span className={`badge badge-${source.type}`}>
          {SOURCE_TYPE_LABEL[source.type] || source.type}
        </span>
        <span className={`badge ${source.enabled ? 'badge-enabled' : 'badge-disabled'}`}>
          {source.enabled ? '已启用' : '已停用'}
        </span>
        <div className="source-actions">
          <button className="btn btn-primary btn-sm" disabled={syncing} onClick={handleSync}>
            {syncing ? (
              <>
                <span className="spinner" /> 同步中…
              </>
            ) : (
              '立即同步'
            )}
          </button>
          <button className="btn btn-outline btn-sm" onClick={toggleReports}>
            {expanded ? '收起记录' : '同步记录'}
          </button>
          <button className="btn btn-danger-ghost btn-sm" onClick={handleDelete}>
            删除
          </button>
        </div>
      </div>
      <div className="source-meta">
        {endpoint && (
          <span className="source-endpoint" title={endpoint}>
            📎 {endpoint}
          </span>
        )}
        <span>⏱ 同步周期：{source.schedule || '手动'}</span>
        <span>🔄 上次同步：{formatDateTime(source.last_sync_at)}</span>
      </div>

      {expanded && (
        <div className="reports-panel">
          {reportsLoading && <p className="state-text">加载同步记录…</p>}
          {reportsError && <p className="state-text error-text">加载失败：{reportsError}</p>}
          {!reportsLoading && !reportsError && reports && reports.length === 0 && (
            <p className="state-text">暂无同步记录</p>
          )}
          {reports &&
            reports.map((report) => (
              <div className="report-item" key={report.id}>
                <div className="report-head">
                  <span
                    className={`badge ${
                      report.status === 'success'
                        ? 'badge-success'
                        : report.status === 'running'
                          ? 'badge-running'
                          : 'badge-failed'
                    }`}
                  >
                    {report.status === 'success' ? '成功' : report.status === 'running' ? '进行中' : '失败'}
                  </span>
                  <span className="report-time">
                    {formatDateTime(report.started_at)}
                    {report.finished_at ? ` → ${formatDateTime(report.finished_at)}` : ''}
                  </span>
                </div>
                {report.status === 'success' ? (
                  <div className="report-stats">{statsSummary(report.stats)}</div>
                ) : report.error ? (
                  <div className="report-error">错误：{report.error}</div>
                ) : null}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

/* ================= 知识库卡片（概览 tab） ================= */

function CollectionCard({ collection, showToast, onSaved }) {
  const [desc, setDesc] = useState(collection.description || '')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  useEffect(() => {
    setDesc(collection.description || '')
  }, [collection.description])

  const dirty = desc !== (collection.description || '')

  async function save() {
    if (!dirty || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await updateCollection(collection.name, desc)
      showToast(`「${collection.name}」描述已保存`)
      onSaved?.()
    } catch (err) {
      showToast(err.message || '保存失败', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="collection-card">
      <div className="collection-head">
        <span className="collection-icon">📚</span>
        <span className="collection-name">{collection.name}</span>
      </div>
      <div className="collection-stats">
        <div className="stat">
          <span className="stat-value">{collection.documents ?? 0}</span>
          <span className="stat-label">文档</span>
        </div>
        <div className="stat">
          <span className="stat-value">{collection.chunks ?? 0}</span>
          <span className="stat-label">知识块</span>
        </div>
        <div className="stat">
          <span className="stat-value">{collection.digests ?? 0}</span>
          <span className="stat-label">摘要</span>
        </div>
      </div>
      <span className="form-label">描述</span>
      <input
        className="input"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={save}
        placeholder="点击编辑描述…"
      />
      <div className="collection-footer">
        <button className="btn btn-outline btn-sm" disabled={!dirty || saving} onClick={save}>
          {saving ? '保存中…' : '保存描述'}
        </button>
      </div>
    </div>
  )
}

/* ================= 知识库主页面 ================= */

export default function KnowledgePage({ showToast }) {
  const [activeTab, setActiveTab] = useState('files')

  const [documents, setDocuments] = useState([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState(null)

  const [sources, setSources] = useState([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState(null)

  const [collections, setCollections] = useState([])
  const [colsLoading, setColsLoading] = useState(true)
  const [colsError, setColsError] = useState(null)

  const [uploading, setUploading] = useState(false)
  const [uploadReport, setUploadReport] = useState(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState(null)
  const [creating, setCreating] = useState(false)

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true)
    setDocsError(null)
    try {
      setDocuments(await fetchDocuments(COLLECTION))
    } catch (err) {
      setDocsError(err.message)
    } finally {
      setDocsLoading(false)
    }
  }, [])

  const loadSources = useCallback(async () => {
    setSourcesLoading(true)
    setSourcesError(null)
    try {
      setSources(await fetchSources(COLLECTION))
    } catch (err) {
      setSourcesError(err.message)
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  const loadCollections = useCallback(async () => {
    setColsLoading(true)
    setColsError(null)
    try {
      setCollections(await fetchCollections())
    } catch (err) {
      setColsError(err.message)
    } finally {
      setColsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDocuments()
    loadSources()
    loadCollections()
  }, [loadDocuments, loadSources, loadCollections])

  function refreshAll() {
    loadDocuments()
    loadSources()
    loadCollections()
  }

  /* ---------- 文件上传与文档管理 ---------- */

  async function handleFiles(files) {
    if (!files.length || uploading) return
    setUploading(true)
    setUploadReport(null)
    try {
      const report = await uploadFiles(files, COLLECTION)
      setUploadReport(report)
      const docs = report?.documents || []
      const learned = docs.filter((d) => d.status !== 'skipped').length
      const chunks = docs.reduce((sum, d) => sum + (d.chunks || 0), 0)
      if (learned > 0) showToast(`已学习 ${learned} 个文件，共 ${chunks} 个知识块`)
      else showToast('文件内容未发生变化，已跳过学习', 'info')
      loadDocuments()
      loadCollections()
    } catch (err) {
      showToast(err.message || '上传失败', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteDoc(doc) {
    if (!window.confirm(`确定删除文档「${doc.title}」吗？删除后不可恢复。`)) return
    try {
      await deleteDocument(doc.id)
      showToast(`文档「${doc.title}」已删除`)
      loadDocuments()
      loadCollections()
    } catch (err) {
      showToast(err.message || '删除失败', 'error')
    }
  }

  /* ---------- 数据源创建 ---------- */

  async function handleCreateSource(e) {
    e.preventDefault()
    setFormError(null)

    const name = form.name.trim()
    if (!name) {
      setFormError('请填写数据源名称')
      return
    }

    let config
    try {
      if (form.type === 'rest_api') {
        if (!form.url.trim()) throw new Error('请填写接口地址 URL')
        if (!form.id_field.trim()) throw new Error('请填写 id_field（用于唯一标识每条数据）')
        const headers = parseJsonField(form.headers, 'headers')
        const params = parseJsonField(form.params, 'params')
        config = {
          url: form.url.trim(),
          method: form.method || 'GET',
          ...(form.items_path.trim() ? { items_path: form.items_path.trim() } : {}),
          id_field: form.id_field.trim(),
          ...(form.updated_field.trim() ? { updated_field: form.updated_field.trim() } : {}),
          content_fields: splitList(form.content_fields),
          ...(headers ? { headers } : {}),
          ...(params ? { params } : {}),
        }
      } else {
        if (!form.dsn.trim()) throw new Error('请填写数据库连接串 DSN')
        if (!form.query.trim()) throw new Error('请填写查询 SQL')
        config = {
          dsn: form.dsn.trim(),
          query: form.query.trim(),
          ...(form.id_field.trim() ? { id_field: form.id_field.trim() } : {}),
          ...(form.updated_field.trim() ? { updated_field: form.updated_field.trim() } : {}),
          content_fields: splitList(form.content_fields),
        }
      }
    } catch (err) {
      setFormError(err.message)
      return
    }

    const payload = {
      collection: COLLECTION,
      name,
      type: form.type,
      config,
      schedule: form.schedule.trim() || null,
    }

    setCreating(true)
    try {
      await createSource(payload)
      showToast(`数据源「${name}」创建成功`)
      setForm(EMPTY_FORM)
      loadSources()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="knowledge-page">
      <div className="knowledge-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">知识库</h1>
            <p className="page-subtitle">管理智能体的学习资料：上传文档、接入数据源、查看整体概况</p>
          </div>
        </div>

        <div className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ================ 文件管理 ================ */}
        {activeTab === 'files' && (
          <>
            <section className="panel">
              <h2 className="panel-title">上传文件</h2>
              <p className="panel-desc">文件将被切分为知识块存入「default」知识库，对话时自动引用</p>
              <FileUpload onFiles={handleFiles} disabled={uploading} busy={uploading} />
              {uploadReport?.documents?.length > 0 && (
                <div className="upload-results">
                  {uploadReport.documents.map((doc) => (
                    <div className="upload-result-item" key={doc.id || doc.title}>
                      <span className="doc-title">{doc.title}</span>
                      <span className={`badge badge-${doc.status}`}>
                        {UPLOAD_STATUS_LABEL[doc.status] || doc.status}
                      </span>
                      <span className="upload-chunks">{doc.chunks} 个知识块</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">文档列表</h2>
                <button className="btn btn-ghost btn-sm" onClick={loadDocuments}>
                  刷新
                </button>
              </div>
              {docsLoading ? (
                <p className="state-text">加载中…</p>
              ) : docsError ? (
                <p className="state-text error-text">加载失败：{docsError}</p>
              ) : documents.length === 0 ? (
                <div className="empty">暂无文档，先在上方上传一些文件吧</div>
              ) : (
                <div className="doc-list">
                  {documents.map((doc) => (
                    <div className="doc-item" key={doc.id}>
                      <div className="doc-icon">📄</div>
                      <div className="doc-info">
                        <div className="doc-title">{doc.title}</div>
                        <div className="doc-meta">
                          <span>{DOC_SOURCE_LABEL[doc.source_type] || doc.source_type}</span>
                          <span>{doc.chunks} 个知识块</span>
                          <span>{formatDateTime(doc.created_at)}</span>
                        </div>
                      </div>
                      <div className="doc-actions">
                        <button className="btn btn-danger-ghost btn-sm" onClick={() => handleDeleteDoc(doc)}>
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* ================ 数据源 ================ */}
        {activeTab === 'sources' && (
          <>
            <div className="info-banner">
              <span className="info-icon">💡</span>
              <span>
                <b>什么是数据源？</b>
                数据源让智能体自动从你已部署项目的接口（rest_api）或数据库（database）中抓取资料，
                切分学习后构建知识库。配置同步周期（cron 表达式）后可定时自动更新，
                也可以随时点击「立即同步」手动触发。
              </span>
            </div>

            <section className="panel">
              <h2 className="panel-title">添加数据源</h2>
              <p className="panel-desc">接入已部署项目，让智能体持续从你的业务数据中学习</p>
              <form onSubmit={handleCreateSource} noValidate>
                <div className="form-grid">
                  <Field label="名称" required>
                    <input
                      className="input"
                      value={form.name}
                      onChange={(e) => setField('name', e.target.value)}
                      placeholder="如：新闻接口"
                    />
                  </Field>
                  <Field label="类型" required>
                    <select
                      className="select"
                      value={form.type}
                      onChange={(e) => setField('type', e.target.value)}
                    >
                      <option value="rest_api">rest_api · 接口抓取</option>
                      <option value="database">database · 数据库查询</option>
                    </select>
                  </Field>
                  <Field label="同步周期（cron 表达式，留空表示手动同步）" full>
                    <input
                      className="input"
                      value={form.schedule}
                      onChange={(e) => setField('schedule', e.target.value)}
                      placeholder="如：0 */2 * * *（每 2 小时一次）"
                    />
                  </Field>

                  {form.type === 'rest_api' ? (
                    <>
                      <Field label="接口地址 URL" required>
                        <input
                          className="input"
                          value={form.url}
                          onChange={(e) => setField('url', e.target.value)}
                          placeholder="https://example.com/api/news"
                        />
                      </Field>
                      <Field label="请求方法">
                        <select
                          className="select"
                          value={form.method}
                          onChange={(e) => setField('method', e.target.value)}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                        </select>
                      </Field>
                      <Field label="列表字段路径 items_path">
                        <input
                          className="input"
                          value={form.items_path}
                          onChange={(e) => setField('items_path', e.target.value)}
                          placeholder="data.items"
                        />
                      </Field>
                      <Field label="ID 字段 id_field" required>
                        <input
                          className="input"
                          value={form.id_field}
                          onChange={(e) => setField('id_field', e.target.value)}
                          placeholder="id"
                        />
                      </Field>
                      <Field label="更新时间字段 updated_field">
                        <input
                          className="input"
                          value={form.updated_field}
                          onChange={(e) => setField('updated_field', e.target.value)}
                          placeholder="updated_at"
                        />
                      </Field>
                      <Field label="内容字段 content_fields（逗号分隔）">
                        <input
                          className="input"
                          value={form.content_fields}
                          onChange={(e) => setField('content_fields', e.target.value)}
                          placeholder="title, summary, content"
                        />
                      </Field>
                      <Field label="请求头 headers（JSON，可选）" full>
                        <textarea
                          className="textarea"
                          rows={2}
                          value={form.headers}
                          onChange={(e) => setField('headers', e.target.value)}
                          placeholder='{"Authorization": "Bearer xxx"}'
                        />
                      </Field>
                      <Field label="查询参数 params（JSON，可选）" full>
                        <textarea
                          className="textarea"
                          rows={2}
                          value={form.params}
                          onChange={(e) => setField('params', e.target.value)}
                          placeholder='{"limit": 100}'
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="数据库连接串 DSN" required full>
                        <input
                          className="input"
                          value={form.dsn}
                          onChange={(e) => setField('dsn', e.target.value)}
                          placeholder="sqlite:///data/app.db 或 postgresql+psycopg://user:pass@host:5432/db"
                        />
                      </Field>
                      <Field label="查询 SQL" required full>
                        <textarea
                          className="textarea"
                          rows={3}
                          value={form.query}
                          onChange={(e) => setField('query', e.target.value)}
                          placeholder="SELECT id, title, content, updated_at FROM articles"
                        />
                      </Field>
                      <Field label="ID 字段 id_field">
                        <input
                          className="input"
                          value={form.id_field}
                          onChange={(e) => setField('id_field', e.target.value)}
                          placeholder="id"
                        />
                      </Field>
                      <Field label="更新时间字段 updated_field">
                        <input
                          className="input"
                          value={form.updated_field}
                          onChange={(e) => setField('updated_field', e.target.value)}
                          placeholder="updated_at"
                        />
                      </Field>
                      <Field label="内容字段 content_fields（逗号分隔）" full>
                        <input
                          className="input"
                          value={form.content_fields}
                          onChange={(e) => setField('content_fields', e.target.value)}
                          placeholder="title, content"
                        />
                      </Field>
                    </>
                  )}
                </div>

                {formError && <div className="form-error">⚠️ {formError}</div>}

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setForm(EMPTY_FORM)
                      setFormError(null)
                    }}
                  >
                    重置
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={creating}>
                    {creating ? (
                      <>
                        <span className="spinner" /> 创建中…
                      </>
                    ) : (
                      '创建数据源'
                    )}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">数据源列表</h2>
                <button className="btn btn-ghost btn-sm" onClick={loadSources}>
                  刷新
                </button>
              </div>
              {sourcesLoading ? (
                <p className="state-text">加载中…</p>
              ) : sourcesError ? (
                <p className="state-text error-text">加载失败：{sourcesError}</p>
              ) : sources.length === 0 ? (
                <div className="empty">还没有数据源，通过上方表单添加一个吧</div>
              ) : (
                <div className="source-list">
                  {sources.map((source) => (
                    <SourceItem
                      key={source.id}
                      source={source}
                      showToast={showToast}
                      onChanged={refreshAll}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* ================ 概览 ================ */}
        {activeTab === 'overview' && (
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">知识库概览</h2>
              <button className="btn btn-ghost btn-sm" onClick={loadCollections}>
                刷新
              </button>
            </div>
            {colsLoading ? (
              <p className="state-text">加载中…</p>
            ) : colsError ? (
              <p className="state-text error-text">加载失败：{colsError}</p>
            ) : collections.length === 0 ? (
              <div className="empty">暂无知识库</div>
            ) : (
              <div className="collection-grid">
                {collections.map((collection) => (
                  <CollectionCard
                    key={collection.name}
                    collection={collection}
                    showToast={showToast}
                    onSaved={loadCollections}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
