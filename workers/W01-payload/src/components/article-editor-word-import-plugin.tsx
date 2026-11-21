import { hasArticleDocumentContent } from '../lib/article-document.js'
import type { ArticleEditorPlugin, ArticleEditorPluginContext } from './ArticleEditorPlugin.js'
import ArticleWordImportButton from './ArticleWordImportButton.js'

function WordImportToolbar({ disabled, updateDocument, value }: ArticleEditorPluginContext) {
  return (
    <ArticleWordImportButton
      disabled={disabled}
      onBeforeImport={() => {
        if (!hasArticleDocumentContent(value)) return true
        return window.confirm('当前文章已有正文或媒体内容。导入 Word 将替换当前文章内容，且不会自动合并。确定继续吗？')
      }}
      onImport={updateDocument}
    />
  )
}

export const articleWordImportPlugin: ArticleEditorPlugin = {
  id: 'word-import',
  label: '导入 Word',
  order: 10,
  Toolbar: WordImportToolbar,
}
