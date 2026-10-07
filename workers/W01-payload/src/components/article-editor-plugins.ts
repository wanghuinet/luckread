import type { ArticleEditorPlugin } from './ArticleEditorPlugin.js'
import { codeBlockPlugin } from './CodeBlockPlugin.js'
import { markdownImportPlugin } from './MarkdownImportPlugin.js'
import { tableBlockPlugin } from './TableBlockPlugin.js'

/**
 * Publish-time editor extensions are registered here.
 *
 * Plugins operate on the existing ArticleDocument model through the typed
 * editor context. Plugin metadata is intentionally not persisted into content.
 */
export const articleEditorPlugins: readonly ArticleEditorPlugin[] = [
  markdownImportPlugin,
  codeBlockPlugin,
  tableBlockPlugin,
]
