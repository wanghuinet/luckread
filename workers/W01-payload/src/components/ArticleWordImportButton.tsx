'use client'

import { useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../lib/client-api.js'

import type { ArticleDocument } from '../lib/article-document.js'
import { collectImportedImages } from '../features/word-import/collect-images.js'
import { parseDocx } from '../features/word-import/docx-parser.js'
import { normalizeImportedDocument } from '../features/word-import/normalizer.js'
import { articleDocumentFromImportedDocument } from '../features/word-import/article-document-adapter.js'

type Props = {
  disabled?: boolean
  onBeforeImport?: () => boolean
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
  mimeType: string,
  idempotencyKey: string,
): Promise<{ id: string; url: string }> {
  const form = new FormData()
  form.append('_payload', JSON.stringify({ alt: alt?.trim() || 'Imported Word image' }))
  form.append('file', new Blob([bytes as BlobPart], { type: mimeType }), filename)

  const { response, data: payload } = await fetchJson<{ doc?: UploadedMedia; url?: string; message?: string; error?: { message?: string } }>('/api/v1/media', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: form,
  })
  const url = payload.doc?.url ?? payload.url
  const mediaId = payload.doc?.id ?? payload.id
  if (!response.ok || typeof url !== 'string' || !url || (typeof mediaId !== 'string' && typeof mediaId !== 'number')) {
    throw new Error(getApiErrorMessage(payload, payload?.message || 'Word 图片上传失败'))
  }
  return { id: String(mediaId), url }
}

async function cleanupUploadedMedia(mediaIds: string[], importScope: string): Promise<void> {
  await Promise.allSettled(
    mediaIds.map((mediaId) =>
      fetch('/api/v1/media/' + encodeURIComponent(mediaId), {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Idempotency-Key': 'word-structured-import-cleanup:' + importScope + ':' + mediaId,
        },
      }),
    ),
  )
}

export default function ArticleWordImportButton({ disabled = false, onBeforeImport, onImport }: Props) {
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
    const importScope = crypto.randomUUID()
    const uploadedMediaIds: string[] = []
    try {
      const imported = normalizeImportedDocument(
        await parseDocx(await file.arrayBuffer(), { maxMediaBytes: MAX_MEDIA_BYTES }),
      )
      const images = collectImportedImages(imported.blocks)
      if (images.length > MAX_IMAGES) throw new Error('Word 文档中的图片不能超过 50 张')

      const mediaRefs = new Map<string, string>()
      const hashToUrl = new Map<string, string>()
      let mediaBytes = 0
      for (const image of images) {
        mediaBytes += image.bytes.byteLength
        if (mediaBytes > MAX_MEDIA_BYTES) throw new Error('Word 文档中的图片总大小不能超过 50 MB')
        const hash = await sha256(image.bytes)
        const existing = hashToUrl.get(hash)
        if (existing) {
          mediaRefs.set(image.mediaKey, existing)
          continue
        }
        const uploaded = await uploadImage(
          image.bytes,
          image.mediaKey.split('/').pop() || 'word-image',
          image.alt,
          image.mimeType,
          'word-structured-import:' + importScope + ':' + hash,
        )
        uploadedMediaIds.push(uploaded.id)
        hashToUrl.set(hash, uploaded.url)
        mediaRefs.set(image.mediaKey, uploaded.url)
      }

      const result = articleDocumentFromImportedDocument(imported, mediaRefs)
      onImport(result.document)
      if (result.warnings.length > 0) {
        window.alert('Word 导入完成。' + '\n' + result.warnings.slice(0, 5).join('\n'))
      }
    } catch (error) {
      if (uploadedMediaIds.length > 0) {
        await cleanupUploadedMedia(uploadedMediaIds, importScope)
      }
      window.alert(error instanceof Error ? error.message : 'Word 导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        disabled={disabled || busy}
        onClick={() => {
          if (onBeforeImport && !onBeforeImport()) return
          inputRef.current?.click()
        }}
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
