'use client'

import { useState } from 'react'
import type { ArticleEditorPlugin, ArticleEditorPluginContext } from './ArticleEditorPlugin.js'
import {
  wordArrayBufferToArticleDocument,
  type WordImportResult,
} from '../lib/word-to-article-document.js'

function WordImportPanel({
  value,
  disabled,
  updateDocument,
}: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [result, setResult] = useState<WordImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function parseFile(file: File) {
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      const next = await wordArrayBufferToArticleDocument(await file.arrayBuffer())
      setResult(next)
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'ARTICLE_WORD_TOO_LARGE'
          ? 'Word 文档超过 10 MB 限制。'
          : cause instanceof Error && cause.message === 'ARTICLE_WORD_EMPTY'
            ? 'Word 文档没有可导入的正文内容。'
            : 'Word 文档解析失败，请确认文件为有效的 .docx 文档。',
      )
    } finally {
      setBusy(false)
    }
  }

  function apply() {
    if (!result) return
    if (result.unsupported.length) {
      setError('文档包含当前编辑器暂不支持的内容，本次不会导入，避免静默丢失。')
      return
    }
    if (mode === 'append' && value.blocks.length + result.document.blocks.length > 200) {
      setError('追加后正文区块将超过 200 个，本次不会导入。')
      return
    }
    updateDocument(
      mode === 'replace'
        ? result.document
        : { ...value, blocks: [...value.blocks, ...result.document.blocks] },
    )
    setOpen(false)
    setResult(null)
    setError(null)
  }

  return (
    <>
      <button
        className="lr-editor-plugin-button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Word
      </button>

      {open ? (
        <div className="lr-editor-plugin-panel lr-editor-word-panel">
          <div className="lr-editor-plugin-panel-head">
            <div>
              <strong>Word 文档导入</strong>
              <span>仅读取 .docx，解析后转换为标准 ArticleDocument。</span>
            </div>
            <button
              aria-label="关闭 Word 导入"
              className="lr-editor-plugin-close"
              onClick={() => setOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>

          <div className="lr-editor-markdown-mode" role="radiogroup" aria-label="导入方式">
            <label>
              <input checked={mode === 'replace'} onChange={() => setMode('replace')} type="radio" />
              替换当前正文
            </label>
            <label>
              <input checked={mode === 'append'} onChange={() => setMode('append')} type="radio" />
              追加到正文末尾
            </label>
          </div>

          <input
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-label="选择 Word 文档"
            disabled={disabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void parseFile(file)
              event.currentTarget.value = ''
            }}
            type="file"
          />

          {busy ? <p aria-live="polite">正在解析 Word 文档…</p> : null}

          {error ? (
            <div className="lr-editor-plugin-error" role="alert">{error}</div>
          ) : null}

          {result ? (
            <div className="lr-editor-markdown-result" aria-live="polite">
              <div>
                <strong>解析结果</strong>
                <span>{result.importedBlocks} 个正文区块</span>
              </div>
              {result.warnings.length ? <p>Word 解析提示：{result.warnings.join('；')}</p> : null}
              {result.unsupported.length ? (
                <p>当前暂不支持：{result.unsupported.join('、')}。本次不会导入。</p>
              ) : (
                <p>检查通过，可以安全写入标准 ArticleDocument。</p>
              )}
              <button
                className="primary"
                disabled={disabled || busy || result.unsupported.length > 0}
                onClick={apply}
                type="button"
              >
                导入正文
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export const wordImportPlugin: ArticleEditorPlugin = {
  id: 'content.word-import',
  label: 'Word 导入',
  order: 90,
  Panel: WordImportPanel,
}
