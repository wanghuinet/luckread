'use client'

import { useMemo, useState } from 'react'
import type { ArticleEditorPlugin, ArticleEditorPluginContext } from './ArticleEditorPlugin.js'

type MediaBlockInfo = {
  blockIndex: number
  type: 'image' | 'gallery'
  refs: string[]
  caption: string
}

function MediaManagerPanel({ value, disabled, updateDocument }: ArticleEditorPluginContext) {
  const [open, setOpen] = useState(false)
  const mediaBlocks = useMemo<MediaBlockInfo[]>(
    () => value.blocks.flatMap((block, blockIndex) => {
      if (block.type !== 'image' && block.type !== 'gallery') return []
      return [{
        blockIndex,
        type: block.type,
        refs: [...(block.mediaRefs ?? [])],
        caption: block.text,
      }]
    }),
    [value],
  )

  function updateRefs(blockIndex: number, refs: string[]) {
    const block = value.blocks[blockIndex]
    if (!block || (block.type !== 'image' && block.type !== 'gallery')) return
    if (block.type === 'image' && refs.length !== 1) return
    if (block.type === 'gallery' && refs.length < 2) return

    updateDocument({
      ...value,
      blocks: value.blocks.map((current, index) =>
        index === blockIndex ? { ...current, mediaRefs: refs } : current,
      ),
    })
  }

  function moveRef(blockIndex: number, refIndex: number, direction: -1 | 1) {
    const block = value.blocks[blockIndex]
    if (!block || block.type !== 'gallery' || !block.mediaRefs) return
    const target = refIndex + direction
    if (target < 0 || target >= block.mediaRefs.length) return
    const refs = [...block.mediaRefs]
    ;[refs[refIndex], refs[target]] = [refs[target], refs[refIndex]]
    updateRefs(blockIndex, refs)
  }

  function removeRef(blockIndex: number, refIndex: number) {
    const block = value.blocks[blockIndex]
    if (!block || block.type !== 'gallery' || !block.mediaRefs || block.mediaRefs.length <= 2) return
    updateRefs(blockIndex, block.mediaRefs.filter((_, index) => index !== refIndex))
  }

  if (!open) {
    return (
      <button
        className="lr-editor-plugin-button"
        disabled={disabled || mediaBlocks.length === 0}
        onClick={() => setOpen(true)}
        title="管理正文媒体区块"
        type="button"
      >
        媒体管理
      </button>
    )
  }

  return (
    <aside className="lr-editor-media-manager lr-editor-plugin-panel" aria-label="媒体区块管理">
      <div className="lr-editor-plugin-panel-head">
        <div>
          <strong>媒体区块管理</strong>
          <span>仅调整现有媒体引用，不上传文件，不改变文章数据模型。</span>
        </div>
        <button
          aria-label="关闭媒体区块管理"
          className="lr-editor-plugin-close"
          onClick={() => setOpen(false)}
          type="button"
        >
          ×
        </button>
      </div>

      <div className="lr-editor-media-manager-list">
        {mediaBlocks.map((media) => (
          <section className="lr-editor-media-manager-block" key={String(media.blockIndex)}>
            <div className="lr-editor-media-manager-head">
              <strong>{media.type === 'gallery' ? '图库' : '图片'} · 第 {media.blockIndex + 1} 区块</strong>
              <span>{media.refs.length} 张</span>
            </div>
            <div className="lr-editor-media-manager-grid">
              {media.refs.map((ref, refIndex) => (
                <div className="lr-editor-media-manager-item" key={ref + ':' + refIndex}>
                  <img alt={media.caption || '正文图片'} loading="lazy" src={ref} />
                  {media.type === 'gallery' ? (
                    <div>
                      <button
                        aria-label="图片左移"
                        disabled={disabled || refIndex === 0}
                        onClick={() => moveRef(media.blockIndex, refIndex, -1)}
                        type="button"
                      >
                        ←
                      </button>
                      <button
                        aria-label="图片右移"
                        disabled={disabled || refIndex === media.refs.length - 1}
                        onClick={() => moveRef(media.blockIndex, refIndex, 1)}
                        type="button"
                      >
                        →
                      </button>
                      <button
                        aria-label="移除图片"
                        disabled={disabled || media.refs.length <= 2}
                        onClick={() => removeRef(media.blockIndex, refIndex)}
                        type="button"
                      >
                        移除
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}

export const mediaManagerPlugin: ArticleEditorPlugin = {
  id: 'content.media-manager',
  label: '媒体管理',
  order: 190,
  Panel: MediaManagerPanel,
}
