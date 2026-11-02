import type { ReactNode } from 'react'

import '../../../styles/twitter-clone-globals.scss'

/**
 * Canonical username content URLs are routed through the frontend route
 * group, but their shared page shell uses the Twitter-clone Tailwind system.
 * Load that stylesheet only for this subtree and provide its dark-mode scope.
 */
export default function PublicUsernameContentLayout({ children }: { children: ReactNode }) {
  return <div className="dark min-h-screen">{children}</div>
}
