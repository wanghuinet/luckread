type VisibilityListener = () => void

const listeners = new Map<Element, VisibilityListener>()
let sharedObserver: IntersectionObserver | null = null

function getSharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (sharedObserver) return sharedObserver

  sharedObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const listener = listeners.get(entry.target)
      if (!listener) continue
      listeners.delete(entry.target)
      sharedObserver?.unobserve(entry.target)
      listener()
    }

    if (listeners.size === 0) {
      sharedObserver?.disconnect()
      sharedObserver = null
    }
  }, { rootMargin: '700px 0px' })

  return sharedObserver
}

/**
 * Observe timeline cards through one shared observer instead of allocating one
 * IntersectionObserver per mounted card. Each card is unobserved as soon as it
 * enters the prefetch window, and the shared observer is released when idle.
 */
export function observeTimelineCard(target: Element, onVisible: VisibilityListener): () => void {
  const observer = getSharedObserver()
  if (!observer) {
    const frame = requestAnimationFrame(onVisible)
    return () => cancelAnimationFrame(frame)
  }

  listeners.set(target, onVisible)
  observer.observe(target)

  return () => {
    listeners.delete(target)
    observer.unobserve(target)
    if (listeners.size === 0) {
      observer.disconnect()
      if (sharedObserver === observer) sharedObserver = null
    }
  }
}
