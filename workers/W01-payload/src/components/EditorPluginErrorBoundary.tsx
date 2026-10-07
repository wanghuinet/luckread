'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  pluginId: string
  children: ReactNode
}

type State = {
  hasError: boolean
}

export default class EditorPluginErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Keep plugin failures isolated from the main editor surface.
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="lr-editor-plugin-fallback" role="alert">
        插件“{this.props.pluginId}”暂时不可用。
      </div>
    )
  }
}
