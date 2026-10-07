'use client'

import { useMemo, useState } from 'react'
import {
  ARTICLE_MAX_BLOCK_TEXT,
  ARTICLE_TABLE_MAX_CELL_TEXT,
  type ArticleBlock,
  type ArticleDocument,
} from '../lib/article-document.js'
import type { ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

const replaceAllText = (value: string, search: string, replacement: string): string =>
  search ? value.split(search).join(replacement) : value

const countMatches = (value: string, search: string): number => {
  if (!search) return 0
  return value === search ? 1 : value.split(search).length - 1
}

function validateBlockLength(block: ArticleBlock): boolean {
  if (block.text.length > ARTICLE_MAX_BLOCK_TEXT) return false
  if (block.type !== 'table' || !block.table) return true
  return block.table.headers.every((cell) => cell.length <= ARTICLE_TABLE_MAX_CELL_TEXT) &&
    block.table.rows.every((row) =>
      row.every((cell) => cell.length <= ARTICLE_TABLE_MAX_CELL_TEXT),
    )
}

function FindReplacePanel({ disabled, value, updateDocument }: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [message, setMessage] = useState('')

  const matchCount = useMemo(() => {
    if (!search) return 0
    const normalize = (input: string) => caseSensitive ? input : input.toLocaleLowerCase()
    const needle = normalize(search)
    return value.blocks.reduce((total, block) => {
      if (block.type === 'table' && block.table) {
        return total +
          block.table.headers.reduce((sum, cell) => sum + countMatches(normalize(cell), needle), 0) +
          block.table.rows.reduce(
            (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + countMatches(normalize(cell), needle), 0),
            0,
          )
      }
      return total + countMatches(normalize(block.text), needle)
    }, 0)
  }, [caseSensitive, search, value])

  function replaceAll() {
    setMessage('')
    if (!search) {
      setMessage('请输入查找内容。')
      return
    }

    const nextBlocks = value.blocks.map((block) => {
      const nextText = replaceAllTextCaseAware(block.text, search, replacement, caseSensitive)
      if (block.type !== 'table' || !block.table) {
        return { ...block, text: nextText }
      }

      const headers = block.table.headers.map((cell) =>
        replaceAllTextCaseAware(cell, search, replacement, caseSensitive),
      )
      const rows = block.table.rows.map((row) =>
        row.map((cell) => replaceAllTextCaseAware(cell, search, replacement, caseSensitive)),
      )
      return {
        ...block,
        text: rows.map((row) => row.join('\t')).join('\n'),
        table: { headers, rows },
      }
    })

    if (!nextBlocks.some(validateBlockLength)) {
      setMessage('替换结果超过编辑器长度限制，未执行替换。')
      return
    }

    if (JSON.stringify(nextBlocks) === JSON.stringify(value.blocks)) {
      setMessage('没有找到匹配内容。')
      return
    }

    updateDocument({ ...value, blocks: nextBlocks })
    setMessage('已替换 ' + String(matchCount) + ' 处。')
  }

  if (!open) {
    return (
      <button
        className="lr-editor-plugin-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="查找并替换正文内容"
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
          <span>一次替换整个文章区块，不新增搜索接口，也不改变正文数据模型。</span>
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
          onClick={() => {
            setSearch('')
            setReplacement('')
            setMessage('')
          }}
          type="button"
        >
          清空
        </button>
      </div>

      {message ? <div className="lr-editor-plugin-error" role="status">{message}</div> : null}
    </section>
  )
}

function replaceAllTextCaseAware(
  value: string,
  search: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (caseSensitive || !search) return replaceAllText(value, search, replacement)

  const pattern = search.replace(/[.*+?^$\\{}()|[\\]\\]/g, '\\function replaceAllTextCaseAware(
  value: string,
  search: string,
  replacement: string,
  caseSensitive: boolean,
): string {
  if (caseSensitive || !search) return replaceAllText(value, search, replacement)

  const needle = search.toLocaleLowerCase()
  const source = value.toLocaleLowerCase()
  let output = ''
  let cursor = 0
  let index = source.indexOf(needle)

  while (index !== -1) {
    output += value.slice(cursor, index) + replacement
    cursor = index + search.length
    index = source.indexOf(needle, cursor)
  }

  return output + value.slice(cursor)
}')
  return value.replace(new RegExp(pattern, 'giu'), () => replacement)
}

export const findReplacePlugin = {
  id: 'content.find-replace',
  label: '查找替换',
  order: 140,
  Panel: FindReplacePanel,
}
