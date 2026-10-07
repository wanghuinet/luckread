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


export const normalizeArticleEditorPlugins = (
  plugins: readonly ArticleEditorPlugin[],
): ArticleEditorPlugin[] => {
  const seen = new Set<string>()
  return plugins
    .filter((plugin) => plugin.id.trim())
    .slice()
    .sort(
      (left, right) =>
        (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id),
    )
    .filter((plugin) => {
      const id = plugin.id.trim()
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
}
