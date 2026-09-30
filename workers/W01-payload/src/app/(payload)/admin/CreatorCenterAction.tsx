'use client'

import Link from 'next/link'

export function CreatorCenterAction() {
  return (
    <Link
      href="/admin/creator-center"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 34,
        padding: '0 12px',
        borderRadius: 9,
        border: '1px solid var(--theme-elevation-200)',
        color: 'var(--theme-elevation-900)',
        textDecoration: 'none',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      创作者中心
    </Link>
  )
}
