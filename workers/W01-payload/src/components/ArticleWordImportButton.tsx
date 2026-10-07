'use client'

import { useRef, useState } from 'react'

import type { ArticleDocument } from '../lib/article-document.js'
import { parseDocx } from '../features/word-import/docx-parser.js'
import { normalizeImportedDocument } from '../features/word-import/normalizer.js'
import { articleDocumentFromImportedDocument } from '../features/word-import/article-document-adapter.js'

type Props = {
  disabled?: boolean
  onImport: (document: ArticleDocument) => void
}

type UploadedMedia = {
  url?: string
  id?: string | number
}

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const MAX_IMAGES = 50

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function uploadImage(
  bytes: Uint8Array,
  filename: string,
  alt: string | undefined,
  idempotencyKey: string,
): Promise<string> {
  const form = new FormData()
  form.append('_payload', JSON.stringify({ alt: alt?.trim() || 'Imported Word image' }))
  form.append('file', new Blob([bytes as BlobPart]), filename)

  const response = await fetch('/api/v1/media', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: form,
  })
  const payload = await response.json().catch((): { doc?: UploadedMedia; url?: string; message?: string; error?: { message?: string } } => ({}))
  const url = payload.doc?.url ?? payload.url
  if (!response.ok || typeof url !== 'string' || !url) {
    throw new Error(payload.error?.message || payload.message || 'Word 图片上传失败')
  }
  return url
}

export default function ArticleWordImportButton({ disabled = false, onImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function importWord(file: File) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      window.alert('目前仅支持 .docx Word 文档')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      window.alert('Word 文档不能超过 50 MB')
      return
    }

    setBusy(true)
    try {
      const imported = normalizeImportedDocument(
        await parseDocx(await file.arrayBuffer(), { maxMediaBytes: MAX_MEDIA_BYTES }),
      )
      const imageKeys = imported.blocks.flatMap((block) => {
        if (block.kind === 'image') return [block.mediaKey]
        if (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'listItem') {
          return block.inlines.filter((inline) => inline.kind === 'inlineImage').map((inline) => inline.image.mediaKey)
        }
        if (block.kind === 'list') {
          return block.items.flatMap((item) => item.inlines.filter((inline) => inline.kind === 'inlineImage').map((inline) => inline.image.mediaKey))
        }
        return block.rows.flatMap((row) => row.flatMap(() => [] as string[]))
      })
      if (imageKeys.length > MAX_IMAGES) throw new Error('Word 文档中的图片不能超过 50 张')

      const mediaRefs = new Map<string, string>()
      const hashToUrl = new Map<string, string>()
      let mediaBytes = 0
      for (const block of imported.blocks) {
        const images = block.kind === 'image'
          ? [block]
          : block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'listItem'
            ? block.inlines.filter((inline) => inline.kind === 'inlineImage').map((inline) => inline.image)
            : block.kind === 'list'
              ? block.items.flatMap((item) => item.inlines.filter((inline) => inline.kind === 'inlineImage').map((inline) => inline.image))
              : block.kind === 'table'
                ? []
                : []
        for (const image of images) {
          mediaBytes += image.bytes.byteLength
          if (mediaBytes > MAX_MEDIA_BYTES) throw new Error('Word 文档中的图片总大小不能超过 50 MB')
          const hash = await sha256(image.bytes)
          const existing = hashToUrl.get(hash)
          if (existing) {
            mediaRefs.set(image.mediaKey, existing)
            continue
          }
          const url = await uploadImage(
            image.bytes,
            image.mediaKey.split('/').pop() || 'word-image',
            image.alt,
            'word-structured-import-' + hash,
          )
          hashToUrl.set(hash, url)
          mediaRefs.set(image.mediaKey, url)
        }
      }

      const result = articleDocumentFromImportedDocument(imported, mediaRefs)
      onImport(result.document)
      if (result.warnings.length > 0) {
        window.alert('Word 导入完成。' + '\n' + result.warnings.slice(0, 5).join('\n'))
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Word 导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        type="button"
        title="从 Word 导入文章"
      >
        {busy ? '导入中…' : '导入 Word'}
      </button>
      <input
        ref={inputRef}
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importWord(file)
        }}
        type="file"
        aria-label="导入 Word 文档"
      />
    </>
  )
}
