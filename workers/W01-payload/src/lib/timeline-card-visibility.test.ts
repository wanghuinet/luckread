import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeTimelineCard } from './timeline-card-visibility'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  readonly unobserved: Element[] = []
  disconnected = false

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    this.observed.add(target)
  }

  unobserve(target: Element) {
    this.observed.delete(target)
    this.unobserved.push(target)
  }

  disconnect() {
    this.disconnected = true
    this.observed.clear()
  }

  intersect(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  MockIntersectionObserver.instances = []
})

describe('shared timeline card visibility observer', () => {
  it('shares one observer and releases each card after it enters the prefetch window', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    const first = {} as Element
    const second = {} as Element
    const onFirstVisible = vi.fn()
    const onSecondVisible = vi.fn()

    const stopFirst = observeTimelineCard(first, onFirstVisible)
    const stopSecond = observeTimelineCard(second, onSecondVisible)
    const observer = MockIntersectionObserver.instances[0]

    expect(MockIntersectionObserver.instances).toHaveLength(1)
    expect(observer.observed).toEqual(new Set([first, second]))

    observer.intersect(first)
    expect(onFirstVisible).toHaveBeenCalledTimes(1)
    expect(onSecondVisible).not.toHaveBeenCalled()
    expect(observer.observed).toEqual(new Set([second]))

    observer.intersect(second)
    expect(onSecondVisible).toHaveBeenCalledTimes(1)
    expect(observer.disconnected).toBe(true)

    stopFirst()
    stopSecond()
  })

  it('unobserves a card when its component is cleaned up before intersection', () => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    const target = {} as Element
    const onVisible = vi.fn()
    const stop = observeTimelineCard(target, onVisible)
    const observer = MockIntersectionObserver.instances[0]

    stop()

    expect(observer.unobserved).toContain(target)
    expect(observer.disconnected).toBe(true)
    observer.intersect(target)
    expect(onVisible).not.toHaveBeenCalled()
  })

  it('uses a cancellable animation-frame fallback when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const request = vi.fn(() => 17)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const onVisible = vi.fn()

    const stop = observeTimelineCard({} as Element, onVisible)
    stop()

    expect(request).toHaveBeenCalledWith(onVisible)
    expect(cancel).toHaveBeenCalledWith(17)
  })
})
