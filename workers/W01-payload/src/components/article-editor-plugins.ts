import type { ArticleEditorPlugin } from './ArticleEditorPlugin.js'
import { codeBlockPlugin } from './CodeBlockPlugin.js'
import { markdownExportPlugin } from './MarkdownExportPlugin.js'
import { markdownImportPlugin } from './MarkdownImportPlugin.js'
import { mathBlockPlugin } from './MathBlockPlugin.js'
import { findReplacePlugin } from './FindReplacePlugin.js'
import { articleOutlinePlugin } from './ArticleOutlinePlugin.js'
import { copyPlainTextPlugin, writerStatsPlugin } from './WriterToolsPlugin.js'
import { undoRedoPlugin } from './UndoRedoPlugin.js'
import { tableBlockPlugin } from './TableBlockPlugin.js'

/**
 * Publish-time editor extensions are registered here.
 *
 * Plugins operate on the existing ArticleDocument model through the typed
 * editor context. Plugin metadata is intentionally not persisted into content.
 */
export const articleEditorPlugins: readonly ArticleEditorPlugin[] = [
  markdownImportPlugin,
  markdownExportPlugin,
  codeBlockPlugin,
  tableBlockPlugin,
  mathBlockPlugin,
  findReplacePlugin,
  articleOutlinePlugin,
  writerStatsPlugin,
  copyPlainTextPlugin,
  undoRedoPlugin,
]
