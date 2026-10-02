'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChangeEvent, FormEvent, useEffect, useState } from 'react'

type Profile = {
  id: string
  email: string
  username: string
  displayName: string | null
  bio: string | null
  avatar: string | null
  locale: string | null
  timezone: string | null
}

const fields: Array<keyof Omit<Profile, 'id' | 'email'>> = [
  'username',
  'displayName',
  'bio',
  'avatar',
  'locale',
  'timezone',
]

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [etag, setEtag] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const response = await fetch('/api/v1/users/me', {
          credentials: 'include',
          headers: { accept: 'application/json' },
        })
        if (response.status === 401) {
          const returnTo = window.location.pathname + window.location.search + window.location.hash
          router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
          return
        }
        const data = await response.json().catch((): null => null)
        if (!response.ok || !data?.id) {
          throw new Error(data?.error?.message || '个人资料加载失败')
        }
        if (cancelled) return
        setProfile(data as Profile)
        setEtag(response.headers.get('ETag') ?? '')
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : '个人资料加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [router])

  function updateField(field: keyof Profile, value: string) {
    setProfile((current) => current ? { ...current, [field]: value } : current)
  }

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    setError('')
    try {
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok && response.status !== 401) {
        throw new Error('LOGOUT_FAILED')
      }
      window.location.assign('/')
    } catch {
      setError('退出登录失败，请稍后重试。')
      setLoggingOut(false)
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('头像必须是图片文件。')
      return
    }

    setMessage('正在上传头像…')
    setError('')
    try {
      const form = new FormData()
      form.append('alt', file.name)
      form.append('file', file)
      const response = await fetch('/api/v1/media', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        body: form,
      })
      const data = await response.json().catch((): null => null) as { doc?: { url?: string }; url?: string; error?: { message?: string } } | null
      const url = data?.doc?.url ?? data?.url
      if (!response.ok || typeof url !== 'string' || !url) {
        throw new Error(data?.error?.message || 'AVATAR_UPLOAD_FAILED')
      }
      setProfile((current) => current ? { ...current, avatar: url } : current)
      setMessage('头像已上传，请保存资料以正式更新。')
    } catch (cause) {
      setMessage('')
      setError(cause instanceof Error ? cause.message : '头像上传失败，请稍后重试。')
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !etag) return

    setSaving(true)
    setMessage('')
    setError('')

    const payload = Object.fromEntries(
      fields.map((field) => [field, profile[field] ?? null]),
    )

    try {
      const response = await fetch('/api/v1/users/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'If-Match': etag,
        },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch((): null => null)
      if (response.status === 412) {
        throw new Error('个人资料已被其他页面修改，请刷新后再保存。')
      }
      if (!response.ok || !data?.id) {
        throw new Error(data?.error?.message || '个人资料保存失败')
      }
      setProfile(data as Profile)
      setEtag(response.headers.get('ETag') ?? etag)
      setMessage('已保存')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '个人资料保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '48px auto', padding: '0 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, letterSpacing: 1.5, color: '#666' }}>ACCOUNT PROFILE</p>
          <h1 style={{ margin: '8px 0 4px' }}>个人资料</h1>
          <p style={{ margin: 0, color: '#666' }}>更新你的公开创作者资料与地区设置。</p>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href="/me/followers">我的粉丝</Link>
          <Link href="/me/following">我的关注</Link>
          <Link href="/me/subscriptions">我的订阅</Link>
          <Link href="/me/sessions">登录设备</Link>
          <Link href="/me/password">修改密码</Link>
          <Link href="/admin/creator-center">创作者中心</Link>
        </div>
      </div>

      {loading ? <p role="status">正在加载…</p> : null}
      {!loading && error && !profile ? <p role="alert">{error}</p> : null}

      {profile ? (
        <form onSubmit={save} style={{ marginTop: 32, display: 'grid', gap: 18 }}>
          <label>
            <span>登录邮箱</span>
            <input value={profile.email} disabled style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
          <label>
            <span>用户名</span>
            <input
              value={profile.username}
              onChange={(event) => updateField('username', event.target.value)}
              maxLength={128}
              required
              style={{ display: 'block', width: '100%', marginTop: 6 }}
            />
          </label>
          <label>
            <span>显示名称</span>
            <input
              value={profile.displayName ?? ''}
              onChange={(event) => updateField('displayName', event.target.value)}
              maxLength={256}
              style={{ display: 'block', width: '100%', marginTop: 6 }}
            />
          </label>
          <label>
            <span>个人简介</span>
            <textarea
              value={profile.bio ?? ''}
              onChange={(event) => updateField('bio', event.target.value)}
              maxLength={2000}
              rows={6}
              style={{ display: 'block', width: '100%', marginTop: 6 }}
            />
          </label>
          <label>
            <span>头像地址</span>
            <input
              type="url"
              value={profile.avatar ?? ''}
              onChange={(event) => updateField('avatar', event.target.value)}
              maxLength={2048}
              style={{ display: 'block', width: '100%', marginTop: 6 }}
            />
            <span style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
              <input
                accept="image/*"
                aria-label="上传头像图片"
                disabled={saving || loggingOut}
                onChange={uploadAvatar}
                type="file"
              />
              <small>上传后仍需点击“保存资料”。</small>
            </span>
          </label>
          <div style={{ display: 'grid', gap: 18, gridTemplateColumns: '1fr 1fr' }}>
            <label>
              <span>语言</span>
              <input
                value={profile.locale ?? ''}
                onChange={(event) => updateField('locale', event.target.value)}
                maxLength={64}
                style={{ display: 'block', width: '100%', marginTop: 6 }}
              />
            </label>
            <label>
              <span>时区</span>
              <input
                value={profile.timezone ?? ''}
                onChange={(event) => updateField('timezone', event.target.value)}
                maxLength={128}
                style={{ display: 'block', width: '100%', marginTop: 6 }}
              />
            </label>
          </div>

          {error ? <p role="alert">{error}</p> : null}
          {message ? <p role="status">{message}</p> : null}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button disabled={saving || loggingOut} type="submit">
              {saving ? '保存中…' : '保存资料'}
            </button>
            <button disabled={saving || loggingOut} onClick={() => router.push('/admin/creator-center')} type="button">
              返回创作者中心
            </button>
            <button disabled={saving || loggingOut} onClick={() => void logout()} type="button">
              {loggingOut ? '正在退出…' : '退出登录'}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  )
}
