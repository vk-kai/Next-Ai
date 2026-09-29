import { useRef, useState } from 'react'

export default function FileUpload({ onFiles, disabled = false, busy = false, hint }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  function pickFiles() {
    if (disabled) return
    inputRef.current?.click()
  }

  function emit(fileList) {
    const files = Array.from(fileList || [])
    if (files.length) onFiles?.(files)
  }

  return (
    <div
      className={`file-upload${dragOver ? ' drag-over' : ''}${disabled ? ' disabled' : ''}`}
      onClick={pickFiles}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (!disabled) emit(e.dataTransfer.files)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          pickFiles()
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          emit(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="upload-icon">📄</div>
      <div className="upload-main">{busy ? '正在上传并学习…' : '拖拽文件到此处，或点击选择文件'}</div>
      <div className="upload-hint">{hint || '支持多文件上传，上传后自动切分为知识块并学习'}</div>
    </div>
  )
}
