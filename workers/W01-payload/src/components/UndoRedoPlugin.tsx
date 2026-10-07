'use client'

import { useEffect, useRef, useState } from 'react'
import type { ArticleDocument, ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

const MAX_HISTORY_ENTRIES = 40
const MAX_HISTORY_CHARS = 2_000_000

const serializeDocument = (value: ArticleDocument): string => JSON.stringify(value)

const parseDocument = (snapshot: string): ArticleDocument | null => {
  try {
    const parsed: unknown = JSON.parse(snapshot)
    if (!parsed || typeof parsed !== 'object' || !('blocks' in parsed)) return null
    return parsed as ArticleDocument
  } catch {
    return null
  }
}

const trimHistory = (entries: readonly string[]): string[] => {
  const next = entries.slice(-MAX_HISTORY_ENTRIES)
  let total = 0
  let start = next.length
  for (let index = next.length - 1; index >= 0; index -= 1) {
    total += next[index]!.length
    if (total > MAX_HISTORY_CHARS) {
      start = index + 1
      break
    }
    start = index
  }
  return next.slice(start)
}

function HistoryToolbar({ value, disabled, updateDocument }: ArticleEditorPluginContext) {
  const [, forceRefresh] = useState(0)
  const pastRef = useRef<string[]>([])
  const futureRef = useRef<string[]>([])
  const lastSerializedRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  const skipRecordRef = useRef(false)

  const sync = () => forceRefresh((count) => count + 1)

  useEffect(() => {
    const serialized = serializeDocument(value)

    if (!initializedRef.current) {
      initializedRef.current = true
      lastSerializedRef.current = serialized
      sync()
      return
    }

    if (serialized === lastSerializedRef.current) return

    if (skipRecordRef.current) {
      skipRecordRef.current = false
    } else if (lastSerializedRef.current !== null) {
      pastRef.current = trimHistory([...pastRef.current, lastSerializedRef.current])
      futureRef.current = []
    }

    lastSerializedRef.current = serialized
    sync()
  }, [value])

  const undo = () => {
    const snapshot = pastRef.current.pop()
    if (!snapshot) return

    const current = lastSerializedRef.current
    const document = parseDocument(snapshot)
    if (!document) {
      sync()
      return
    }

    if (current) futureRef.current = trimHistory([current, ...futureRef.current])
    skipRecordRef.current = true
    updateDocument(document)
    sync()
  }

  const redo = () => {
    const snapshot = futureRef.current.shift()
    if (!snapshot) return

    const current = lastSerializedRef.current
    const document = parseDocument(snapshot)
    if (!document) {
      sync()
      return
    }

    if (current) pastRef.current = trimHistory([...pastRef.current, current])
    skipRecordRef.current = true
    updateDocument(document)
    sync()
  }

  const clear = () => {
    pastRef.current = []
    futureRef.current = []
    sync()
  }

  const pastCount = pastRef.current.length
  const futureCount = futureRef.current.length

  return (
    <div className="lr-editor-history-tools" role="group" aria-label="编辑历史">
      <button
        className="lr-editor-plugin-button"
        disabled={disabled || pastCount === 0}
        onClick={undo}
        title="撤销上一次文档变更"
        type="button"
      >
        ↶ 撤销{pastCount ? ' ' + pastCount : ''}
      </button>
      <button
        className="lr-editor-plugin-button"
        disabled={disabled || futureCount === 0}
        onClick={redo}
        title="恢复上一次撤销的文档变更"
        type="button"
      >
        ↷ 重做{futureCount ? ' ' + futureCount : ''}
      </button>
      <button
        className="lr-editor-plugin-button"
        disabled={disabled || (pastCount === 0 && futureCount === 0)}
        onClick={clear}
        title="清空当前编辑会话的撤销历史"
        type="button"
      >
        清空历史
      </button>
    </div>
  )
}

export const undoRedoPlugin = {
  id: 'content.undo-redo',
  label: '撤销重做',
  order: 180,
  Toolbar: HistoryToolbar,
}
