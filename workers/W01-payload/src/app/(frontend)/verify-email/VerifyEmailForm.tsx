'use client'

import { FormEvent, useState } from 'react'

import { fetchJson, getApiErrorMessage, jsonHeaders } from '../../../lib/client-api.js'

type ApiError = {
  error?: {
    code?: string
    message?: string
  }
}

type FormStatus = 'idle' | 'sending' | 'accepted' | 'error'

export default function VerifyEmailForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    const normalizedEmail = email.trim().toLowerCase()
    if (
      normalizedEmail.length === 0 ||
      normalizedEmail.length > 254 ||
      !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail)
    ) {
      setStatus('error')
      setMessage('请输入有效的注册邮箱地址。')
      return
    }

    setStatus('sending')
    try {
      const { response, data } = await fetchJson<ApiError | null>('/api/v1/auth/verification/send', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ identity: normalizedEmail }),
      })

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, '验证邮件请求暂时无法完成，请稍后重试。'))
      }

      setStatus('accepted')
      setMessage('如果该邮箱对应尚未验证的账号，系统已受理验证邮件请求。请检查收件箱和垃圾邮件；未收到时可稍后重试。')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : '网络异常，验证邮件请求未能完成，请稍后重试。')
    }
  }

  return (
    <form className="lr-auth-form" onSubmit={submit} aria-busy={status === 'sending'}>
      <label>
        注册邮箱
        <input
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </label>
      {message ? (
        <div
          className={status === 'error' ? 'lr-error' : 'lr-muted'}
          role={status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message}
        </div>
      ) : null}
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending'
          ? '正在提交…'
          : status === 'accepted'
            ? '重新发送验证邮件'
            : '发送验证邮件'}
      </button>
    </form>
  )
}
