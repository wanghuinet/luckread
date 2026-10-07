'use client'

import type { LexicalEditor } from '@payloadcms/richtext-lexical/lexical'
import type { PluginComponent, ToolbarGroupItem } from '@payloadcms/richtext-lexical'
import * as React from 'react'

import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from '@payloadcms/richtext-lexical/lexical'
import { $generateNodesFromDOM } from '@payloadcms/richtext-lexical/lexical/html'
import {
  createClientFeature,
  toolbarAddDropdownGroupWithItems,
} from '@payloadcms/richtext-lexical/client'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { useEffect, useRef, useState } from 'react'

import { parseDocx } from './docx-parser.js'
import type { ImportedInline } from './model.js'
import { renderImportedDocument } from './html-builder.js'
import { normalizeImportedDocument } from './normalizer.js'

export const IMPORT_WORD_COMMAND = createCommand<void>('LUCKREAD_IMPORT_WORD')

const ACCEPTED_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_IMAGES = 50
const MAX_MEDIA_BYTES = 50 * 1024 * 1024

interface MediaUploadResponse {
  id?: string | number
  doc?: { id?: string | number }
  message?: string
}

function WordIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path
        d="M4 3.5A1.5 1.5 0 0 1 5.5 2H14l6 6v12.5A1.5 1.5 0 0 1 18.5 22h-13A1.5 1.5 0 0 1 4 20.5v-17ZM14 3.5V9h5.5M7 13.5l1.4 5h1.2l1-3.2 1 3.2h1.2l1.4-5h-1.3l-.8 3.1-.9-3.1h-1.2l-.9 3.1-.8-3.1H7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function extractUploadId(payload: MediaUploadResponse): string | undefined {
  const id = payload.doc?.id ?? payload.id
  return id === undefined || id === null ? undefined : String(id)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function uploadImage(file: Blob, filename: string, alt: string | undefined, idempotencyKey: string): Promise<string> {
  const form = new FormData()
  form.append('_payload', JSON.stringify({ alt: alt?.trim() || 'Imported Word image' }))
  form.append('file', file, filename)

  const response = await fetch('/api/v1/media', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: form,
  })

  let payload: MediaUploadResponse = {}
  try {
    payload = (await response.json()) as MediaUploadResponse
  } catch {
    // HTTP status is handled below.
  }

  if (!response.ok) {
    throw new Error(payload.message || 'Word image upload failed (' + response.status + ')')
  }

  const id = extractUploadId(payload)
  if (!id) throw new Error('Word image upload returned no media ID')
  return id
}

async function uploadImportedImages(
  document: ReturnType<typeof normalizeImportedDocument>,
  importScope: string,
): Promise<Map<string, string>> {
  const images: Extract<(typeof document.blocks)[number], { kind: 'image' }>[] = []
  const collectInlineImages = (inlines: ImportedInline[]): void => {
    for (const inline of inlines) {
      if (inline.kind === 'inlineImage') images.push(inline.image)
    }
  }
  const collect = (blocks: typeof document.blocks): void => {
    for (const block of blocks) {
      if (block.kind === 'image') {
        images.push(block)
      } else if (block.kind === 'table') {
        for (const row of block.rows) for (const cell of row) collect(cell.blocks)
      } else if (block.kind === 'list') {
        for (const item of block.items) collectInlineImages(item.inlines)
      } else if (block.kind === 'listItem') {
        collectInlineImages(block.inlines)
      }
    }
  }
  collect(document.blocks)

  if (images.length > MAX_IMAGES) {
    throw new Error('The Word document contains more than 50 images')
  }

  let totalBytes = 0
  const result = new Map<string, string>()
  const hashToId = new Map<string, string>()

  for (const image of images) {
    totalBytes += image.bytes.byteLength
    if (totalBytes > MAX_MEDIA_BYTES) {
      throw new Error('The Word document exceeds the 50 MB imported image budget')
    }

    const hash = await sha256(image.bytes)
    const existing = hashToId.get(hash)
    if (existing) {
      result.set(image.mediaKey, existing)
      continue
    }

    const id = await uploadImage(
      new Blob([image.bytes as BlobPart], { type: image.mimeType }),
      image.mediaKey.split('/').pop() || 'word-image',
      image.alt,
      'word-import-' + importScope + '-' + hash,
    )
    hashToId.set(hash, id)
    result.set(image.mediaKey, id)
  }

  return result
}

function insertHtmlAtSelection(editor: LexicalEditor, html: string): void {
  const documentNode = new DOMParser().parseFromString(html, 'text/html')
  const nodes = $generateNodesFromDOM(editor, documentNode)

  editor.update(() => {
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      selection.insertNodes(nodes)
    } else {
      $getRoot().append(...nodes)
    }
  })
}

const importButtonItem: ToolbarGroupItem = {
  key: 'luckreadImportWord',
  label: '导入 Word',
  ChildComponent: WordIcon,
  onSelect: ({ editor }) => {
    editor.dispatchCommand(IMPORT_WORD_COMMAND, undefined)
  },
}

export const WordImportPlugin: PluginComponent = () => {
  const [editor] = useLexicalComposerContext()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return editor.registerCommand(
      IMPORT_WORD_COMMAND,
      () => {
        if (!busy) inputRef.current?.click()
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [busy, editor])

  const onFile = async (file: File): Promise<void> => {
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
      const importScope = crypto.randomUUID()
      const media = await uploadImportedImages(imported, importScope)
      const html = renderImportedDocument(imported, (key) => {
        const id = media.get(key)
        return id ? { id } : undefined
      })

      insertHtmlAtSelection(editor, html)

      if (imported.warnings.length > 0) {
        window.alert(
          'Word 导入完成。' +
            '\n已处理：' + imported.stats.paragraphs + ' 段正文、' +
            imported.stats.images + ' 张图片、' +
            imported.stats.tables + ' 个表格。' +
            '\n' + imported.warnings.map((warning) => warning.message).slice(0, 3).join('\n'),
        )
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Word 导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <input
      ref={inputRef}
      type="file"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      hidden
      aria-label="导入 Word 文档"
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void onFile(file)
      }}
    />
  )
}

export const WordImportFeatureClient = createClientFeature({
  plugins: [
    {
      Component: WordImportPlugin,
      position: 'normal',
    },
  ],
  toolbarFixed: {
    groups: [toolbarAddDropdownGroupWithItems([importButtonItem])],
  },
})
