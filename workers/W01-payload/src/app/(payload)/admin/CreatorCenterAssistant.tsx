"use client"

import { useEffect, useRef, useState } from 'react'

type Props = {
  qualityTarget?: string
}

export default function CreatorCenterAssistant({ qualityTarget = 'quality' }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current && !panelRef.current.contains(target)) setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  function goToQualityGate() {
    setOpen(false)
    window.requestAnimationFrame(() => {
      document.getElementById(qualityTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const target = document.querySelector<HTMLElement>(
        '.lr-preflight-report, .lr-preflight-policy, button'
      )
      target?.focus?.({ preventScroll: true })
    })
  }

  function triggerComposerCheck() {
    setOpen(false)
    window.requestAnimationFrame(() => {
      document.getElementById(qualityTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (item) => item.textContent?.trim() === '发布前自检',
      )
      button?.click()
    })
  }

  return (
    <div className={styles.assistantDock} ref={panelRef}>
      {open ? (
        <section className={styles.assistantPanel} aria-label="发布前检测助手">
          <div className={styles.assistantPanelHead}>
            <div>
              <span className={styles.assistantKicker}>CREATOR CHECK</span>
              <strong>发布前检测助手</strong>
            </div>
            <button
              className={styles.assistantClose}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭检测助手"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>

          <p className={styles.assistantSummary}>
            自动检查真正发生在现有发布器中，助手只负责快速进入检测区，不创建第二套检测系统。
          </p>

          <div className={styles.assistantChecks}>
            <div><i className="fa-solid fa-check" aria-hidden="true" /><span>内容质量</span><small>正文结构与可读性</small></div>
            <div><i className="fa-solid fa-magnifying-glass" aria-hidden="true" /><span>SEO</span><small>标题、外链与内容准备度</small></div>
            <div><i className="fa-solid fa-shield-halved" aria-hidden="true" /><span>安全与导流</span><small>联系方式、账号与二维码风险</small></div>
            <div><i className="fa-solid fa-robot" aria-hidden="true" /><span>AI 规范</span><small>AI 使用方式与原创确认</small></div>
          </div>

          <div className={styles.assistantActions}>
            <button className={styles.assistantPrimary} type="button" onClick={triggerComposerCheck}>
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
              立即自检
            </button>
            <button className={styles.assistantSecondary} type="button" onClick={goToQualityGate}>
              查看检测区
            </button>
          </div>
        </section>
      ) : null}

      <button
        className={styles.floatingAssistant}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="creator-check-assistant"
      >
        <span className={styles.assistantDot}>
          <i className={open ? 'fa-solid fa-xmark' : 'fa-solid fa-shield-heart'} aria-hidden="true" />
        </span>
        <span className={styles.floatingAssistantText}>
          <strong>{open ? '关闭助手' : '检测助手'}</strong>
          <small>{open ? 'Esc 可关闭' : '发布前自检'}</small>
        </span>
      </button>
    </div>
  )
}

import styles from './creator-center.module.css'
