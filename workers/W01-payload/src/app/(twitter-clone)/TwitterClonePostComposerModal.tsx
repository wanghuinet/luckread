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
  const [quoteContentId, setQuoteContentId] = useState<string | null>(null)
  const [quoteRelationshipPending, setQuoteRelationshipPending] = useState(false)
  const panelRef = useRef<HTMLElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const showComposer = (event: Event) => {
      setQuoteRelationshipPending(false)
      const detail = event instanceof CustomEvent && event.detail && typeof event.detail === 'object'
        ? event.detail as { quoteContentId?: unknown }
        : null
      const requestedQuoteId = typeof detail?.quoteContentId === 'string' ? detail.quoteContentId.trim() : ''
      setQuoteContentId(requestedQuoteId || null)
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setHasOpened(true)
      setOpen(true)
    }
    const updateQuotePending = (event: Event) => {
      const detail = event instanceof CustomEvent && event.detail && typeof event.detail === 'object'
        ? event.detail as { pending?: unknown }
        : null
      setQuoteRelationshipPending(detail?.pending === true)
    }
    window.addEventListener(OPEN_POST_COMPOSER_EVENT, showComposer)
    window.addEventListener('luckread:quote-relationship-pending', updateQuotePending)
    return () => {
      window.removeEventListener(OPEN_POST_COMPOSER_EVENT, showComposer)
      window.removeEventListener('luckread:quote-relationship-pending', updateQuotePending)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!quoteRelationshipPending) setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null)
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    panelRef.current?.querySelector('textarea')?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      if (openerRef.current?.isConnected) openerRef.current.focus()
    }
  }, [open, quoteRelationshipPending])

  if (!hasOpened || typeof document === 'undefined') return null

  return createPortal(
    <div
      aria-hidden={!open}
      className={open
        ? 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-0 sm:items-center sm:p-4'
        : 'hidden'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !quoteRelationshipPending) setOpen(false)
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
        <PublishComposer
          key={quoteContentId ?? 'new-post'}
          initialType="post"
          presentation="tweet-modal"
          quoteContentId={quoteContentId ?? undefined}
          onClose={() => {
            if (quoteRelationshipPending) return
            setOpen(false)
            setQuoteContentId(null)
          }}
        />
      </section>
    </div>,
    document.body,
  )
}
