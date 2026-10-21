import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getApiErrorMessage } from '../lib/api-client';

import {
  AuthInput,
  AuthMessage,
  AuthPrimaryButton,
  AuthScreen,
  AuthTextLink,
  AUTH_COLORS,
} from '../components/auth/AuthScreen';
import {
  isValidAuthEmail,
  normalizeAuthEmail,
  requestEmailVerification,
} from '../lib/auth-flow-api';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const submit = async () => {
    if (submitting) return;
    setMessage('');
    setErrorMessage('');
    const normalizedEmail = normalizeAuthEmail(email);
    if (!isValidAuthEmail(normalizedEmail)) {
      setErrorMessage('请输入有效的注册邮箱。');
      return;
    }

    setSubmitting(true);
    try {
      const { response, data } = await requestEmailVerification(normalizedEmail);
      if (response.ok) {
        setMessage('如果该邮箱对应尚未验证的账号，系统已受理验证邮件请求。请检查收件箱和垃圾邮件。');
      } else if (response.status === 429) {
        setErrorMessage('请求过于频繁，请稍等片刻后重试。');
      } else if (response.status >= 500) {
        setErrorMessage('验证邮件服务暂时不可用，请稍后重试。');
      } else {
        setErrorMessage(getApiErrorMessage(data, '验证邮件请求未能完成，请稍后重试。', response.status));
      }
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : '网络异常，验证邮件请求未能完成。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreen title="验证你的邮箱" subtitle="收不到验证邮件？输入注册邮箱，我们会再次检查并受理发送请求。">
      <AuthInput
        label="注册邮箱"
        accessibilityLabel="注册邮箱"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
        onChangeText={setEmail}
        onSubmitEditing={() => void submit()}
        placeholder="name@example.com"
        returnKeyType="go"
        textContentType="emailAddress"
        value={email}
      />
      <AuthMessage message={errorMessage} />
      <AuthMessage message={message} variant="success" />
      <AuthPrimaryButton label="发送验证邮件" busy={submitting} onPress={() => void submit()} />
      <View style={{ marginTop: 18, alignItems: 'center' }}>
        <AuthTextLink label="返回登录" onPress={() => router.replace('/login' as never)} />
        <AuthTextLink label="创建账号" onPress={() => router.push('/register' as never)} />
      </View>
      <Text style={{ color: AUTH_COLORS.secondary, fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: 'center' }}>
        为保护账号隐私，页面不会确认这个邮箱是否已注册或完成验证。
      </Text>
    </AuthScreen>
  );
}
