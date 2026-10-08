'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type ArticleEditorPlugin,
  type ArticleEditorPluginContext,
  type EditorMediaAsset,
  normalizeArticleEditorPlugins,
} from './ArticleEditorPlugin.js'
import {
  ARTICLE_MAX_BLOCKS,
  ARTICLE_MAX_BLOCK_TEXT,
  type ArticleBlock,
  type ArticleBlockType,
  type ArticleDocument,
  createArticleBlock,
  createArticleMediaBlock,
  duplicateArticleBlock,
  insertArticleBlockAfter,
  insertArticleMediaBlockAfter,
  mediaRefsFromArticleDocument,
  removeMediaRefFromArticleDocument,
  reorderArticleMediaRef,
  mergeArticleBlockWithPrevious,
  splitArticleBlock,
  transformArticleBlock,
  normalizeArticleDocument,
  plainTextFromArticleDocument,
  parseArticleBlockFromClipboard,
  serializeArticleBlockForClipboard,
} from '../lib/article-document.js'
import {
  createArticleDocumentHistory,
  recordArticleDocumentHistory,
  redoArticleDocumentHistory,
  undoArticleDocumentHistory,
  type ArticleDocumentHistory,
} from '../lib/article-document-history.js'

type Props = {
  value: ArticleDocument
  disabled?: boolean
  mediaAssets?: EditorMediaAsset[]
  onChange: (value: ArticleDocument, plainText: string) => void
  plugins?: readonly ArticleEditorPlugin[]
}

const blockLabels: Record<ArticleBlockType, string> = {
  paragraph: '正文',
  heading: '标题',
  quote: '引用',
  bulletList: '无序列表',
  orderedList: '有序列表',
  divider: '分隔线',
  image: '图片',
  gallery: '图库',
}

const updateBlock = (
  document: ArticleDocument,
  index: number,
  patch: Partial<ArticleBlock>,
): ArticleDocument => ({
  ...document,
  blocks: document.blocks.map((block, blockIndex) =>
    blockIndex === index ? { ...block, ...patch } : block,
  ),
})

export default function ArticleStructuredEditor({ value, disabled = false, mediaAssets = [], onChange, plugins = [] }: Props) {
  const editorRef = useRef<HTMLElement | null>(null)
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const blockRefs = useRef<Record<string, HTMLElement | null>>({})
  const mediaButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const pendingFocusRef = useRef<{ blockId: string; offset: number } | null>(null)
  const pendingMediaFocusRef = useRef<string | null>(null)
  const historyRef = useRef<ArticleDocumentHistory>(createArticleDocumentHistory())
  const pendingHistorySnapshotRef = useRef<string | null>(null)
  const lastDocumentSnapshotRef = useRef(JSON.stringify(value))
  const [historyState, setHistoryState] = useState({ past: 0, future: 0 })

  function syncHistoryState(history: ArticleDocumentHistory) {
    historyRef.current = history
    setHistoryState({ past: history.past.length, future: history.future.length })
  }

  useEffect(() => {
    const mediaFocusKey = pendingMediaFocusRef.current
    if (mediaFocusKey) {
      const button = mediaButtonRefs.current[mediaFocusKey]
      if (button && !button.disabled) {
        pendingMediaFocusRef.current = null
        button.focus()
        return
      }
    }

    const request = pendingFocusRef.current
    if (!request) return
    const textarea = textAreaRefs.current[request.blockId]
    if (textarea) {
      pendingFocusRef.current = null
      textarea.focus()
      const offset = Math.max(0, Math.min(request.offset, textarea.value.length))
      textarea.setSelectionRange(offset, offset)
      return
    }
    const block = blockRefs.current[request.blockId]
    if (!block) return
    pendingFocusRef.current = null
    block.focus()
  }, [value])

  useEffect(() => {
    const currentSnapshot = JSON.stringify(value)
    if (pendingHistorySnapshotRef.current === currentSnapshot) {
      pendingHistorySnapshotRef.current = null
      lastDocumentSnapshotRef.current = currentSnapshot
      return
    }
    if (lastDocumentSnapshotRef.current !== currentSnapshot) {
      historyRef.current = createArticleDocumentHistory()
      setHistoryState({ past: 0, future: 0 })
      lastDocumentSnapshotRef.current = currentSnapshot
    }
  }, [value])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !editorRef.current?.contains(document.activeElement) || disabled) return
      const target = event.target
      if (target instanceof HTMLElement && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) return

      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const redo = key === 'y' || (key === 'z' && event.shiftKey)
      if (redo ? historyRef.current.future.length === 0 : historyRef.current.past.length === 0) return

      event.preventDefault()
      const result = redo
        ? redoArticleDocumentHistory(historyRef.current, value)
        : undoArticleDocumentHistory(historyRef.current, value)
      if (!result.document) return
      pendingHistorySnapshotRef.current = JSON.stringify(result.document)
      syncHistoryState(result.history)
      onChange(result.document, plainTextFromArticleDocument(result.document))
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [disabled, onChange, value])

  const imageAssets = useMemo(() => {
    const seenUrls = new Set<string>()
    const result: EditorMediaAsset[] = []

    for (const asset of mediaAssets) {
      const url = asset.url.trim()
      if (!url || !asset.mimeType.startsWith('image/') || seenUrls.has(url)) continue
      seenUrls.add(url)
      result.push(asset)
    }

    for (const ref of mediaRefsFromArticleDocument(value)) {
      const url = ref.trim()
      if (!url || seenUrls.has(url)) continue
      seenUrls.add(url)
      result.push({
        id: 'article-document-media:' + url,
        url,
        filename: '正文已关联图片',
        mimeType: 'image/*',
      })
    }

    return result
  }, [mediaAssets, value])
  const characterCount = useMemo(() => plainTextFromArticleDocument(value).length, [value])

  function emit(next: ArticleDocument) {
    const normalized = normalizeArticleDocument(next)
    const currentSnapshot = JSON.stringify(value)
    const nextSnapshot = JSON.stringify(normalized)
    if (currentSnapshot === nextSnapshot) return
    const nextHistory = recordArticleDocumentHistory(historyRef.current, value, normalized)
    pendingHistorySnapshotRef.current = nextSnapshot
    syncHistoryState(nextHistory)
    lastDocumentSnapshotRef.current = nextSnapshot
    onChange(normalized, plainTextFromArticleDocument(normalized))
  }

  function emitTextEdit(next: ArticleDocument, blockId: string) {
    const normalized = normalizeArticleDocument(next)
    const currentSnapshot = JSON.stringify(value)
    const nextSnapshot = JSON.stringify(normalized)
    if (currentSnapshot === nextSnapshot) return
    const nextHistory = recordArticleDocumentHistory(
      historyRef.current,
      value,
      normalized,
      { coalesceKey: 'text:' + blockId },
    )
    pendingHistorySnapshotRef.current = nextSnapshot
    syncHistoryState(nextHistory)
    lastDocumentSnapshotRef.current = nextSnapshot
    onChange(normalized, plainTextFromArticleDocument(normalized))
  }

  function applyHistory(direction: 'undo' | 'redo') {
    const result = direction === 'undo'
      ? undoArticleDocumentHistory(historyRef.current, value)
      : redoArticleDocumentHistory(historyRef.current, value)
    if (!result.document) return
    const nextSnapshot = JSON.stringify(result.document)
    pendingHistorySnapshotRef.current = nextSnapshot
    syncHistoryState(result.history)
    lastDocumentSnapshotRef.current = nextSnapshot
    onChange(result.document, plainTextFromArticleDocument(result.document))
  }


  function addBlock(type: ArticleBlockType) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    if (type === 'image' || type === 'gallery') {
      const refs = mediaAssets.map((asset) => asset.url).filter(Boolean)
      if (type === 'image' && refs.length < 1) return
      if (type === 'gallery' && refs.length < 2) return
      emit({
        ...value,
        blocks: [...value.blocks, createArticleMediaBlock(type, type === 'image' ? refs.slice(0, 1) : refs.slice(0, 12))],
      })
      return
    }
    emit({
      ...value,
      blocks: [...value.blocks, createArticleBlock(type)],
    })
  }

  function insertMedia(type: 'image' | 'gallery', assetUrls?: string[]) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    const refs = (assetUrls ?? mediaAssets.map((asset) => asset.url)).filter(Boolean)
    if (type === 'image' && refs.length < 1) return
    if (type === 'gallery' && refs.length < 2) return
    emit({
      ...value,
      blocks: [...value.blocks, createArticleMediaBlock(type, type === 'image' ? refs.slice(0, 1) : refs.slice(0, 12))],
    })
  }

  const orderedPlugins = useMemo(
    () => normalizeArticleEditorPlugins(plugins),
    [plugins],
  )

  const pluginContext: ArticleEditorPluginContext = {
    value,
    disabled,
    plainText: plainTextFromArticleDocument(value),
    mediaAssets,
    updateDocument: emit,
    addBlock,
    insertMedia,
    insertMediaAfter,
    insertBlockAfter,
    transformBlock,
  }

  async function copyBlockToClipboard(block: ArticleBlock) {
    try {
      await navigator.clipboard.writeText(serializeArticleBlockForClipboard(block))
    } catch {
      window.alert('复制区块失败，请检查浏览器剪贴板权限。')
    }
  }

  function pasteStructuredBlock(index: number, raw: string) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return false
    const parsed = parseArticleBlockFromClipboard(raw)
    if (!parsed) return false
    const pasted = duplicateArticleBlock(parsed)
    const next = {
      ...value,
      blocks: [
        ...value.blocks.slice(0, index + 1),
        pasted,
        ...value.blocks.slice(index + 1),
      ],
    }
    pendingFocusRef.current = { blockId: pasted.id, offset: 0 }
    emit(next)
    return true
  }

  function duplicateBlock(index: number) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    const source = value.blocks[index]
    if (!source) return
    const duplicate = duplicateArticleBlock(source)
    pendingFocusRef.current = { blockId: duplicate.id, offset: 0 }
    emit({
      ...value,
      blocks: [
        ...value.blocks.slice(0, index + 1),
        duplicate,
        ...value.blocks.slice(index + 1),
      ],
    })
  }

  function insertBlockAfter(index: number) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    const next = insertArticleBlockAfter(value, index, 'paragraph')
    if (next === value) return
    const inserted = next.blocks[index + 1]
    if (inserted) pendingFocusRef.current = { blockId: inserted.id, offset: 0 }
    emit(next)
  }

  function insertMediaAfter(index: number, type: 'image' | 'gallery', assetUrls?: string[]) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    const refs = (assetUrls ?? imageAssets.map((asset) => asset.url)).filter(Boolean)
    if (type === 'image' && refs.length < 1) return
    if (type === 'gallery' && refs.length < 2) return
    const next = insertArticleMediaBlockAfter(value, index, type, refs)
    if (next === value) return
    const inserted = next.blocks[index + 1]
    if (inserted) pendingFocusRef.current = { blockId: inserted.id, offset: 0 }
    emit(next)
  }

  function transformBlock(index: number, type: ArticleBlockType) {
    const source = value.blocks[index]
    if (!source) return
    if (type !== source.type && (source.mediaRefs?.length ?? 0) > 0 && type !== 'image' && type !== 'gallery') {
      const confirmed = window.confirm('转换为文字类区块将从正文结构中移除当前图片，但不会删除素材库中的媒体。确定继续吗？')
      if (!confirmed) return
    }
    const nextBlock = transformArticleBlock(source, type)
    if (nextBlock === source) return
    emit({
      ...value,
      blocks: value.blocks.map((block, blockIndex) =>
        blockIndex === index ? nextBlock : block,
      ),
    })
  }

  function removeBlock(index: number) {
    if (value.blocks.length === 1) return
    const nextBlocks = value.blocks.filter((_, blockIndex) => blockIndex !== index)
    const focusTarget = nextBlocks[index] ?? nextBlocks[index - 1]
    if (focusTarget) {
      pendingFocusRef.current = {
        blockId: focusTarget.id,
        offset: focusTarget.text.length,
      }
    }
    emit({
      ...value,
      blocks: nextBlocks,
    })
  }

  function splitBlockAtCursor(index: number) {
    const block = value.blocks[index]
    const textarea = block ? textAreaRefs.current[block.id] : null
    if (!textarea || !block) return
    const next = splitArticleBlock(value, index, textarea.selectionStart)
    if (next === value) return
    const nextBlock = next.blocks[index + 1]
    if (nextBlock) pendingFocusRef.current = { blockId: nextBlock.id, offset: 0 }
    emit(next)
  }

  function mergeBlockWithPrevious(index: number) {
    const next = mergeArticleBlockWithPrevious(value, index)
    if (next === value) return
    const previous = next.blocks[index - 1]
    if (previous) pendingFocusRef.current = { blockId: previous.id, offset: previous.text.length }
    emit(next)
  }

  function insertParagraphAfter(index: number) {
    if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
    const next = insertArticleBlockAfter(value, index, 'paragraph')
    if (next === value) return
    const inserted = next.blocks[index + 1]
    if (inserted) pendingFocusRef.current = { blockId: inserted.id, offset: 0 }
    emit(next)
  }

  function removeMediaReference(mediaRef: string) {
    const target = mediaRef.trim()
    if (!target) return
    const sourceBlock = value.blocks.find((block) => block.mediaRefs?.includes(target))
    const next = removeMediaRefFromArticleDocument(value, target)
    if (next === value) return
    const nextBlock = sourceBlock ? next.blocks.find((block) => block.id === sourceBlock.id) : undefined
    if (nextBlock) {
      pendingFocusRef.current = {
        blockId: nextBlock.id,
        offset: nextBlock.text.length,
      }
    }
    emit(next)
  }

  function moveMediaReference(blockIndex: number, mediaIndex: number, direction: -1 | 1) {
    const sourceBlock = value.blocks[blockIndex]
    const mediaRef = sourceBlock?.mediaRefs?.[mediaIndex]
    if (!sourceBlock || !mediaRef) return
    const next = reorderArticleMediaRef(value, blockIndex, mediaIndex, mediaIndex + direction)
    if (next === value) return
    pendingMediaFocusRef.current = sourceBlock.id + ':' + mediaRef
    emit(next)
  }

  function moveBlock(index: number, direction: -1 | 1, focusOffset = 0) {
    const target = index + direction
    if (target < 0 || target >= value.blocks.length) return
    const source = value.blocks[index]
    if (!source) return
    const blocks = [...value.blocks]
    ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    const moved = blocks[target]
    if (moved) pendingFocusRef.current = { blockId: moved.id, offset: Math.max(0, Math.min(focusOffset, moved.text.length)) }
    emit({ ...value, blocks })
  }

  return (
    <section ref={editorRef} className="lr-article-editor" aria-label="文章结构化正文编辑器">
      <div className="lr-article-editor-toolbar">
        <div>
          <strong>结构化正文</strong>
          <span>{value.blocks.length} 个区块 · {characterCount} 字</span>
        </div>
        <div className="lr-article-editor-tools" role="toolbar" aria-label="文章编辑操作">
          <button
            aria-label="撤销"
            disabled={disabled || historyState.past === 0}
            onClick={() => applyHistory('undo')}
            title="撤销（Ctrl/Cmd+Z）"
            type="button"
          >
            撤销
          </button>
          <button
            aria-label="重做"
            disabled={disabled || historyState.future === 0}
            onClick={() => applyHistory('redo')}
            title="重做（Ctrl/Cmd+Shift+Z / Ctrl+Y）"
            type="button"
          >
            重做
          </button>
          {([
            ['paragraph', '正文'],
            ['heading', '标题'],
            ['quote', '引用'],
            ['bulletList', '无序列表'],
            ['orderedList', '有序列表'],
            ['divider', '分隔线'],
          ] as const).map(([type, label]) => (
            <button
              key={type}
              disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
              onClick={() => addBlock(type)}
              title={'添加' + label}
              type="button"
            >
              {label}
            </button>
          ))}
          {orderedPlugins.map((plugin) => {
            const Toolbar = plugin.Toolbar
            return Toolbar ? <Toolbar key={plugin.id + ':toolbar'} {...pluginContext} /> : null
          })}
        </div>
      </div>

      <div className="lr-article-media-picker" aria-label="插入图片和图库">
        <div className="lr-article-media-picker-head">
          <strong>正文媒体</strong>
          <span>{imageAssets.length ? imageAssets.length + ' 个可插入图片' : '请先上传图片'}</span>
        </div>
        {imageAssets.length ? (
          <div className="lr-article-media-picker-grid">
            {imageAssets.map((asset) => (
              <div className="lr-article-media-picker-item" key={asset.id}>
                <img alt={asset.filename ?? ''} loading="lazy" src={asset.url} />
                <div>
                  <button disabled={disabled} onClick={() => insertMedia('image', [asset.url])} type="button">插入图片</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <button
          className="lr-article-gallery-button"
          disabled={disabled || imageAssets.length < 2}
          onClick={() => insertMedia('gallery', imageAssets.map((asset) => asset.url))}
          type="button"
        >
          插入全部图库（最多 12 个）
        </button>
        {orderedPlugins.map((plugin) => {
          const Panel = plugin.Panel
          return Panel ? <Panel key={plugin.id + ':panel'} {...pluginContext} /> : null
        })}
      </div>

      <div className="lr-article-editor-hint">
        每个区块可以独立调整顺序和类型。支持复制结构化区块并在正文中粘贴恢复类型、正文和媒体；文本区块支持开头 Backspace 与上一同类区块合并、Ctrl/Cmd+Enter 新建正文、Alt+↑/↓ 移动当前区块并保留光标；列表区块使用换行分隔条目；正文内容最终会以版本化 JSON 资产保存，发布前检查仍使用纯文本抽取结果。
      </div>

      <div className="lr-article-blocks">
        {value.blocks.map((block, index) => (
          <article
            className={'lr-article-block lr-article-block-' + block.type}
            key={block.id}
            ref={(element) => {
              blockRefs.current[block.id] = element
            }}
            tabIndex={-1}
          >
            <div className="lr-article-block-head">
              <span>{blockLabels[block.type]}</span>
              <div>
                <button
                  aria-label="上移区块"
                  disabled={disabled || index === 0}
                  onClick={() => moveBlock(index, -1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label="下移区块"
                  disabled={disabled || index === value.blocks.length - 1}
                  onClick={() => moveBlock(index, 1)}
                  type="button"
                >
                  ↓
                </button>
                <button
                  aria-label="复制区块"
                  disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
                  onClick={() => duplicateBlock(index)}
                  type="button"
                >
                  复制
                </button>
                <button
                  aria-label="复制结构化区块到剪贴板"
                  disabled={disabled}
                  onClick={() => void copyBlockToClipboard(block)}
                  title="复制完整结构区块，可粘贴到文章编辑器"
                  type="button"
                >
                  复制区块
                </button>
                <button
                  aria-label="在下方添加正文区块"
                  disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
                  onClick={() => insertBlockAfter(index)}
                  type="button"
                >
                  ＋
                </button>
                {block.type !== 'divider' && block.type !== 'image' && block.type !== 'gallery' ? (
                  <>
                    <button
                      aria-label="在光标处分段"
                      disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
                      onClick={() => splitBlockAtCursor(index)}
                      title="在当前光标处分段"
                      type="button"
                    >
                      分段
                    </button>
                    <button
                      aria-label="在下方插入并聚焦正文"
                      disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
                      onClick={() => insertParagraphAfter(index)}
                      title="插入正文区块（Ctrl/Cmd+Enter）"
                      type="button"
                    >
                      新段
                    </button>
                    <button
                      aria-label="与上一同类区块合并"
                      disabled={
                        disabled ||
                        index === 0 ||
                        !['paragraph', 'quote', 'bulletList', 'orderedList'].includes(block.type) ||
                        value.blocks[index - 1]?.type !== block.type
                      }
                      onClick={() => mergeBlockWithPrevious(index)}
                      type="button"
                    >
                      合并
                    </button>
                  </>
                ) : null}
                {imageAssets.length ? (
                  <>
                    <button
                      aria-label="在下方插入图片"
                      disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS}
                      onClick={() => insertMediaAfter(index, 'image')}
                      type="button"
                    >
                      插图
                    </button>
                    <button
                      aria-label="在下方插入图库"
                      disabled={disabled || value.blocks.length >= ARTICLE_MAX_BLOCKS || imageAssets.length < 2}
                      onClick={() => insertMediaAfter(index, 'gallery')}
                      type="button"
                    >
                      图库
                    </button>
                  </>
                ) : null}
                <button
                  aria-label="删除区块"
                  disabled={disabled || value.blocks.length === 1}
                  onClick={() => removeBlock(index)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>

            {block.type === 'divider' ? (
              <hr aria-label="内容分隔线" />
            ) : block.type === 'image' || block.type === 'gallery' ? (
              <div className="lr-article-media-block">
                <div className={block.type === 'gallery' ? 'lr-article-gallery-grid' : 'lr-article-image-single'}>
                  {(block.mediaRefs ?? []).map((ref, mediaIndex) => (
                    <figure key={ref}>
                      <img alt={block.text || '文章图片'} loading="lazy" src={ref} />
                      {block.type === 'gallery' ? (
                        <div className="lr-article-media-actions">
                          <button
                            aria-label={'上移第 ' + String(mediaIndex + 1) + ' 张图片'}
                            disabled={disabled || mediaIndex === 0}
                            onClick={() => moveMediaReference(index, mediaIndex, -1)}
                            type="button"
                          >
                            ↑
                          </button>
                          <button
                            aria-label={'下移第 ' + String(mediaIndex + 1) + ' 张图片'}
                            disabled={disabled || mediaIndex === (block.mediaRefs?.length ?? 0) - 1}
                            onClick={() => moveMediaReference(index, mediaIndex, 1)}
                            type="button"
                          >
                            ↓
                          </button>
                          <button
                            ref={(element) => {
                              mediaButtonRefs.current[block.id + ':' + ref] = element
                            }}
                            aria-label="移除正文图片"
                            disabled={disabled}
                            onClick={() => removeMediaReference(ref)}
                            type="button"
                          >
                            从正文移除
                          </button>
                        </div>
                      ) : (
                        <button
                          ref={(element) => {
                            mediaButtonRefs.current[block.id + ':' + ref] = element
                          }}
                          aria-label="移除正文图片"
                          disabled={disabled}
                          onClick={() => removeMediaReference(ref)}
                          type="button"
                        >
                          从正文移除
                        </button>
                      )}
                    </figure>
                  ))}
                </div>
                <textarea
                  aria-label="媒体说明"
                  disabled={disabled}
                  maxLength={ARTICLE_MAX_BLOCK_TEXT}
                  onChange={(event) => emitTextEdit(updateBlock(value, index, { text: event.target.value.slice(0, ARTICLE_MAX_BLOCK_TEXT) }), block.id)}
                  placeholder="可选：添加图片说明…"
                  rows={2}
                  value={block.text}
                />
              </div>
            ) : (
              <textarea
                ref={(element) => {
                  textAreaRefs.current[block.id] = element
                }}
                aria-label={blockLabels[block.type]}
                disabled={disabled}
                maxLength={ARTICLE_MAX_BLOCK_TEXT}
                onChange={(event) => {
                  const next = updateBlock(value, index, {
                    text: event.target.value.slice(0, ARTICLE_MAX_BLOCK_TEXT),
                  })
                  emit(next)
                }}
                placeholder={
                  block.type === 'heading' ? '输入小标题…'
                    : block.type === 'quote' ? '输入引用内容…'
                      : block.type === 'bulletList' || block.type === 'orderedList'
                        ? '每行一个列表条目…'
                        : '写下这一段内容…'
                }
                rows={block.type === 'heading' ? 2 : block.type === 'quote' ? 4 : 5}
                value={block.text}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Backspace' &&
                    event.currentTarget.selectionStart === 0 &&
                    event.currentTarget.selectionEnd === 0
                  ) {
                    const previous = value.blocks[index - 1]
                    if (
                      previous &&
                      ['paragraph', 'quote', 'bulletList', 'orderedList'].includes(block.type) &&
                      previous.type === block.type
                    ) {
                      event.preventDefault()
                      mergeBlockWithPrevious(index)
                      return
                    }
                  }

                  if (
                    (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
                    event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.shiftKey
                  ) {
                    event.preventDefault()
                    moveBlock(index, event.key === 'ArrowUp' ? -1 : 1, event.currentTarget.selectionStart)
                    return
                  }

                  if (
                    event.key.toLowerCase() === 'enter' &&
                    (event.ctrlKey || event.metaKey) &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault()
                    insertParagraphAfter(index)
                  }
                }}
                onPaste={(event) => {
                  const raw = event.clipboardData.getData('text/plain')
                  if (!raw.startsWith('LUCKREAD_ARTICLE_BLOCK_V1:')) return
                  event.preventDefault()
                  pasteStructuredBlock(index, raw)
                }}
              />
            )}

            <label className="lr-article-block-type">
              <span>区块类型</span>
              <select
                aria-label="区块类型"
                disabled={disabled}
                onChange={(event) => transformBlock(index, event.target.value as ArticleBlockType)}
                value={block.type}
              >
                <option value="paragraph">正文</option>
                <option value="heading">标题</option>
                <option value="quote">引用</option>
                <option value="bulletList">无序列表</option>
                <option value="orderedList">有序列表</option>
                <option value="divider">分隔线</option>
                {block.type === 'image' || block.type === 'gallery'
                  ? <option value={block.type}>{block.type === 'image' ? '图片' : '图库'}</option>
                  : null}
                {block.type === 'image' && (block.mediaRefs?.length ?? 0) >= 2
                  ? <option value="gallery">图库</option>
                  : null}
              </select>
            </label>

            {block.type === 'heading' ? (
              <label className="lr-article-heading-level">
                <span>层级</span>
                <select
                  aria-label="标题层级"
                  disabled={disabled}
                  onChange={(event) => emit(updateBlock(value, index, { level: event.target.value === '3' ? 3 : 2 }))}
                  value={block.level ?? 2}
                >
                  <option value="2">H2</option>
                  <option value="3">H3</option>
                </select>
              </label>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
