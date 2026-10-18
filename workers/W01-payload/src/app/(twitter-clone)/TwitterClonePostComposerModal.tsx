'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import PublishComposer from '../(frontend)/publish/PublishComposer'

const OPEN_POST_COMPOSER_EVENT = 'luckread:open-post-composer'

type TwitterClonePostComposerTriggerProps = {
  className: string
  ariaLabel: string
  children: ReactNode
}

export function TwitterClonePostComposerTrigger({
  className,
  ariaLabel,
  children,
}: TwitterClonePostComposerTriggerProps) {
  return (
    <button
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_POST_COMPOSER_EVENT))}
      type="button"
    >
      {children}
    </button>
  )
}

export default function TwitterClonePostComposerModal() {
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const showComposer = () => {
      setHasOpened(true)
      setOpen(true)
    }
    window.addEventListener(OPEN_POST_COMPOSER_EVENT, showComposer)
    return () => window.removeEventListener(OPEN_POST_COMPOSER_EVENT, showComposer)
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    panelRef.current?.querySelector('textarea')?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!hasOpened || typeof document === 'undefined') return null

  return createPortal(
    <div
      aria-hidden={!open}
      className={open
        ? 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-0 sm:items-center sm:p-4'
        : 'hidden'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <section
        aria-label="发推文窗口"
        aria-modal="true"
        className="mt-0 flex max-h-[100dvh] w-full max-w-xl flex-col overflow-y-auto rounded-none border border-[#2f3336] bg-black text-[#e7e9ea] shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="sticky top-0 z-10 flex items-center gap-5 border-b border-[#2f3336] bg-black px-4 py-3 text-[#e7e9ea]">
          <button
            aria-label="关闭发推文窗口"
            className="custom-button accent-tab grid h-9 w-9 place-items-center rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10"
            onClick={() => setOpen(false)}
            type="button"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <h2 className="text-xl font-bold">发推文</h2>
        </header>
        <div className="m-0 min-h-0 w-full bg-black p-0 text-[#e7e9ea]">
          <PublishComposer initialType="post" presentation="tweet-modal" />
        </div>
      </section>
    </div>,
    document.body,
  )
}
