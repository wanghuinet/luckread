import type { ArticleEditorPlugin, ArticleEditorPluginContext } from './ArticleEditorPlugin.js'
import ArticleWordImportButton from './ArticleWordImportButton.js'

function WordImportToolbar({ disabled, updateDocument }: ArticleEditorPluginContext) {
  return <ArticleWordImportButton disabled={disabled} onImport={updateDocument} />
}

export const articleWordImportPlugin: ArticleEditorPlugin = {
  id: 'word-import',
  label: '导入 Word',
  order: 10,
  Toolbar: WordImportToolbar,
}
