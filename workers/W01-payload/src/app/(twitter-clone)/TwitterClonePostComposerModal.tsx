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
        aria-label="发布动态窗口"
        aria-modal="true"
        className="mt-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-none border border-[#2f3336] bg-black text-[#e7e9ea] shadow-xl sm:h-[82vh] sm:max-h-[720px] sm:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <PublishComposer initialType="post" presentation="tweet-modal" onClose={() => setOpen(false)} />
      </section>
    </div>,
    document.body,
  )
}
