import type { ArticleEditorPlugin } from './ArticleEditorPlugin.js'
import { articleWordImportPlugin } from './article-editor-word-import-plugin.js'
import { findReplacePlugin } from './FindReplacePlugin.js'

/**
 * Publish-time editor extensions are registered here.
 *
 * Plugins operate on the existing ArticleDocument model through the typed
 * editor context. Plugin metadata is intentionally not persisted into content.
 */
export const articleEditorPlugins: readonly ArticleEditorPlugin[] = [
  articleWordImportPlugin,
  findReplacePlugin,
]
