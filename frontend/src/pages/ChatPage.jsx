import { useEffect, useRef, useState } from 'react'
import { streamChat, uploadFiles } from '../api'

const COLLECTION = 'default'

const SUGGESTIONS = [
  '帮我总结一下知识库里的内容',
  '根据已有资料，这个项目的核心功能是什么？',
  '基于知识库里的资料，写一份使用说明',
]

export default function ChatPage({ showToast }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const fileInputRef = useRef(null)

  // 新消息或流式追加时自动滚动到底部
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // 输入框自适应高度
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  // 更新最后一条流式生成中的助手消息
  function patchLastAssistant(patch) {
    setMessages((ms) => {
      const copy = [...ms]
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'assistant' && copy[i].pending) {
          const prev = copy[i]
          copy[i] = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
          break
        }
      }
      return copy
    })
  }

  function showStreamError(message) {
    setMessages((ms) => {
      const copy = [...ms]
      for (let i = copy.length - 1; i >= 0; i--) {
        const msg = copy[i]
        if (msg.role === 'assistant' && msg.pending) {
          if (msg.content) {
            // 已经输出过部分内容，错误以新气泡追加
            copy[i] = { ...msg, pending: false }
            copy.push({ role: 'assistant', type: 'error', content: message })
          } else {
            copy[i] = { role: 'assistant', type: 'error', content: message }
          }
          return copy
        }
      }
      copy.push({ role: 'assistant', type: 'error', content: message })
      return copy
    })
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || streaming) return

    // 发送给后端的是包含历史的完整消息数组（只保留 role/content）
    const history = [...messages, { role: 'user', content: text }].map((m) => ({
      role: m.role,
      content: m.content,
    }))

    setMessages((ms) => [
      ...ms,
      { role: 'user', content: text },
      { role: 'assistant', content: '', sources: [], pending: true },
    ])
    setInput('')
    setStreaming(true)

    try {
      await streamChat({
        collection: COLLECTION,
        messages: history,
        onSources: (sources) => patchLastAssistant({ sources }),
        onDelta: (chunk) => patchLastAssistant((m) => ({ content: m.content + chunk })),
        onError: showStreamError,
      })
    } catch (_) {
      showStreamError('请求失败，请稍后重试')
    } finally {
      setStreaming(false)
      setMessages((ms) => ms.map((m) => (m.pending ? { ...m, pending: false } : m)))
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || uploading) return
    setUploading(true)
    try {
      const report = await uploadFiles(files, COLLECTION)
      const docs = report?.documents || []
      const learned = docs.filter((d) => d.status !== 'skipped').length
      const chunks = docs.reduce((sum, d) => sum + (d.chunks || 0), 0)
      if (learned > 0) showToast(`已学习 ${learned} 个文件，共 ${chunks} 个知识块`)
      else showToast('文件内容未发生变化，已跳过学习', 'info')
    } catch (err) {
      showToast(err.message || '上传失败', 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="chat-page">
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="welcome-avatar">🤖</div>
            <div className="welcome-title">你好，我是 Next-AI 智能体</div>
            <p className="welcome-desc">基于知识库回答问题，支持上传文档与接入数据源持续学习</p>
            <div className="suggestions">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  className="suggestion-chip"
                  onClick={() => {
                    setInput(text)
                    inputRef.current?.focus()
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, index) => {
          if (msg.role === 'user') {
            return (
              <div className="msg-row user" key={index}>
                <div className="bubble bubble-user">{msg.content}</div>
              </div>
            )
          }
          if (msg.type === 'error') {
            return (
              <div className="msg-row assistant" key={index}>
                <div className="bubble bubble-error">⚠️ {msg.content}</div>
              </div>
            )
          }
          return (
            <div className="msg-group" key={index}>
              <div className="msg-row assistant">
                <div className="bubble bubble-assistant">
                  {msg.content ? (
                    msg.content
                  ) : msg.pending ? (
                    <span className="typing">
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    '（无内容）'
                  )}
                </div>
              </div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="sources">
                  <span className="sources-label">参考来源：</span>
                  {msg.sources.map((source, i) => (
                    <span
                      className="source-chip"
                      key={i}
                      title={`相关度 ${Math.round((source.score || 0) * 100)}%`}
                    >
                      📄 {source.title}
                      {typeof source.score === 'number' && (
                        <span className="source-score"> {Math.round(source.score * 100)}%</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="chat-composer">
        <div className="composer-card">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder="输入你的问题，Enter 发送，Shift + Enter 换行"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="composer-actions">
            <button
              className="btn btn-outline"
              disabled={uploading || streaming}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <>
                  <span className="spinner spinner-dark" /> 学习中…
                </>
              ) : (
                '📎 上传到知识库'
              )}
            </button>
            <button
              className="btn btn-primary"
              disabled={streaming || !input.trim()}
              onClick={handleSend}
            >
              {streaming ? (
                <>
                  <span className="spinner" /> 回答中…
                </>
              ) : (
                '发送'
              )}
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleUpload} />
        </div>
      </div>
    </div>
  )
}
