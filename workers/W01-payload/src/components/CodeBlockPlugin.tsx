import type {
  ArticleEditorPlugin,
  ArticleEditorPluginContext,
} from './ArticleEditorPlugin.js'

function CodeBlockToolbar({
  disabled,
  addBlock,
}: ArticleEditorPluginContext) {
  return (
    <button
      className="lr-editor-plugin-button"
      disabled={disabled}
      onClick={() => addBlock('code')}
      type="button"
    >
      代码
    </button>
  )
}

export const codeBlockPlugin: ArticleEditorPlugin = {
  id: 'content.code-block',
  label: '代码块',
  order: 110,
  Toolbar: CodeBlockToolbar,
}
