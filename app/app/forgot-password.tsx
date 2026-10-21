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
  requestPasswordRecovery,
} from '../lib/auth-flow-api';

export default function ForgotPasswordScreen() {
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
      const { response, data } = await requestPasswordRecovery(normalizedEmail);
      if (response.ok) {
        setMessage('如果该邮箱对应 LuckRead 账号，系统会发送密码找回邮件。请检查收件箱和垃圾邮件。邮件中的安全链接将在网页中打开。');
      } else if (response.status === 429) {
        setErrorMessage('请求过于频繁，请稍等片刻后重试。');
      } else if (response.status >= 500) {
        setErrorMessage('密码找回服务暂时不可用，请稍后重试。');
      } else {
        setErrorMessage(getApiErrorMessage(data, '找回请求未能处理，请检查邮箱格式后重试。', response.status));
      }
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : '网络异常，找回请求未能完成。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreen title="找回密码" subtitle="输入注册邮箱，我们会发送安全的密码重置链接。">
      <AuthInput
        label="注册邮箱"
        accessibilityLabel="注册邮箱"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
        onChangeText={setEmail}
        placeholder="name@example.com"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        textContentType="emailAddress"
        value={email}
      />
      <AuthMessage message={errorMessage} />
      <AuthMessage message={message} variant="success" />
      <AuthPrimaryButton label="发送找回邮件" busy={submitting} onPress={() => void submit()} />
      <View style={{ marginTop: 18, alignItems: 'center' }}>
        <AuthTextLink label="返回登录" onPress={() => router.replace('/login' as never)} />
        <AuthTextLink label="创建账号" onPress={() => router.push('/register' as never)} />
      </View>
      <Text style={{ color: AUTH_COLORS.secondary, fontSize: 12, lineHeight: 18, marginTop: 16, textAlign: 'center' }}>
        为保护隐私，无论邮箱是否已注册，系统都会显示相同的成功提示。
      </Text>
    </AuthScreen>
  );
}
