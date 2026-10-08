'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ARTICLE_MAX_BLOCK_TEXT,
  type ArticleBlock,
  type ArticleDocument,
} from '../lib/article-document.js'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

export const countTextMatches = (value: string, search: string, caseSensitive: boolean): number => {
  if (!search) return 0
  const source = caseSensitive ? value : value.toLocaleLowerCase()
  const needle = caseSensitive ? search : search.toLocaleLowerCase()
  let count = 0
  let offset = 0
  while (offset <= source.length) {
    const index = source.indexOf(needle, offset)
    if (index < 0) break
    count += 1
    offset = index + needle.length
  }
  return count
}

export const replaceAllTextCaseAware = (
  value: string,
  search: string,
  replacement: string,
  caseSensitive: boolean,
): string => {
  if (!search || caseSensitive) return search ? value.split(search).join(replacement) : value
  const source = value.toLocaleLowerCase()
  const needle = search.toLocaleLowerCase()
  let result = ''
  let offset = 0
  while (offset < value.length) {
    const index = source.indexOf(needle, offset)
    if (index < 0) {
      result += value.slice(offset)
      break
    }
    result += value.slice(offset, index) + replacement
    offset = index + needle.length
  }
  return result
}

export const replaceTextInArticleDocument = (
  value: ArticleDocument,
  search: string,
  replacement: string,
  caseSensitive: boolean,
): ArticleDocument => ({
  ...value,
  blocks: value.blocks.map((block: ArticleBlock) => ({
    ...block,
    text: replaceAllTextCaseAware(block.text, search, replacement, caseSensitive),
  })),
})

const isValidBlockText = (block: ArticleBlock): boolean =>
  block.text.length <= ARTICLE_MAX_BLOCK_TEXT

function FindReplacePanel({ disabled, value, updateDocument }: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f' &&
        !event.altKey
      ) {
        event.preventDefault()
        setOpen(true)
        return
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const matchCount = useMemo(
    () => value.blocks.reduce(
      (total, block) => total + countTextMatches(block.text, search, caseSensitive),
      0,
    ),
    [caseSensitive, search, value.blocks],
  )

  function replaceAll() {
    setMessage('')
    if (!search) {
      setMessage('请输入查找内容。')
      return
    }

    const next = replaceTextInArticleDocument(value, search, replacement, caseSensitive)
    if (!next.blocks.every(isValidBlockText)) {
      setMessage('替换结果超过编辑器单区块长度限制，未执行替换。')
      return
    }
    if (JSON.stringify(next.blocks) === JSON.stringify(value.blocks)) {
      setMessage('没有找到匹配内容。')
      return
    }

    updateDocument(next)
    setMessage('已替换 ' + String(matchCount) + ' 处。')
  }

  if (!open) {
    return (
      <button
        className="lr-editor-plugin-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="查找并替换正文内容（Ctrl/Cmd+Shift+F）"
        type="button"
      >
        查找替换
      </button>
    )
  }

  return (
    <section className="lr-editor-find-replace lr-editor-plugin-panel" aria-label="查找和替换">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>查找和替换</strong>
          <span>只处理当前文章正文，不调用搜索接口，不改变正文数据模型。</span>
        </div>
        <button
          aria-label="关闭查找和替换"
          className="lr-editor-plugin-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          ×
        </button>
      </div>

      <div className="lr-editor-find-replace-fields">
        <label>
          <span>查找</span>
          <input
            aria-label="查找内容"
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="输入要查找的文字…"
            value={search}
          />
        </label>
        <label>
          <span>替换为</span>
          <input
            aria-label="替换内容"
            disabled={disabled}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="输入替换后的文字…"
            value={replacement}
          />
        </label>
      </div>

      <label className="lr-editor-find-replace-option">
        <input
          aria-label="区分大小写"
          checked={caseSensitive}
          disabled={disabled}
          onChange={(event) => setCaseSensitive(event.target.checked)}
          type="checkbox"
        />
        <span>区分大小写</span>
      </label>

      <div className="lr-editor-find-replace-meta" role="status" aria-live="polite">
        当前匹配 {matchCount} 处
      </div>

      <div className="lr-editor-plugin-actions">
        <button className="primary" disabled={disabled || !search} onClick={replaceAll} type="button">
          全部替换
        </button>
        <button
          className="secondary"
          disabled={disabled}
          onClick={() => { setSearch(''); setReplacement(''); setMessage('') }}
          type="button"
        >
          清空
        </button>
      </div>

      {message ? <div className="lr-editor-plugin-status" role="status">{message}</div> : null}
    </section>
  )
}

export const findReplacePlugin = {
  id: 'content.find-replace',
  label: '查找替换',
  order: 140,
  Panel: FindReplacePanel,
}
