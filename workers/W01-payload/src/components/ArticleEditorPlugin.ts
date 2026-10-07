import type { ComponentType } from 'react'

import type { ArticleBlockType, ArticleDocument } from '../lib/article-document.js'

export type EditorMediaAsset = {
  id: string
  url: string
  filename?: string
  mimeType: string
}

export type ArticleEditorPluginContext = {
  value: ArticleDocument
  disabled: boolean
  plainText: string
  mediaAssets: readonly EditorMediaAsset[]
  updateDocument: (next: ArticleDocument) => void
  addBlock: (type: ArticleBlockType) => void
  insertMedia: (type: 'image' | 'gallery', assetUrls?: string[]) => void
}

export type ArticleEditorPlugin = {
  id: string
  label: string
  order?: number
  Toolbar?: ComponentType<ArticleEditorPluginContext>
  Panel?: ComponentType<ArticleEditorPluginContext>
}
