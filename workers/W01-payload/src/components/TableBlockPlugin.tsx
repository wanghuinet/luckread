import type {
  ArticleEditorPlugin,
  ArticleEditorPluginContext,
} from './ArticleEditorPlugin.js'
import { ARTICLE_MAX_BLOCKS, createArticleTableBlock } from '../lib/article-document.js'

function TableBlockToolbar({
  disabled,
  value,
  updateDocument,
}: ArticleEditorPluginContext) {
  return (
    <button
      className="lr-editor-plugin-button"
      disabled={disabled}
      onClick={() => {
        if (value.blocks.length >= ARTICLE_MAX_BLOCKS) return
        updateDocument({
          ...value,
          blocks: [...value.blocks, createArticleTableBlock()],
        })
      }}
      type="button"
    >
      表格
    </button>
  )
}

export const tableBlockPlugin: ArticleEditorPlugin = {
  id: 'content.table-block',
  label: '表格',
  order: 120,
  Toolbar: TableBlockToolbar,
}
