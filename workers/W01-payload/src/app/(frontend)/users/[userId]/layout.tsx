import type { ReactNode } from 'react'

import '../../../../styles/twitter-clone-globals.scss'

/**
 * Load the already-reused ccrsxx Twitter Clone stylesheet only for public
 * profile routes, so its Tailwind utilities and theme tokens are available
 * without restyling unrelated frontend pages.
 */
export default function PublicProfileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="font-twitter-chirp leading-normal text-light-primary dark:text-dark-primary">
      {children}
    </div>
  )
}
