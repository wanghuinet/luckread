import React, { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';

import {
  AuthInput,
  AuthMessage,
  AuthPrimaryButton,
  AuthScreen,
  AuthSecondaryButton,
  AuthTextLink,
  AUTH_COLORS,
} from '../components/auth/AuthScreen';
import { requestEmailVerification, normalizeAuthEmail, isValidAuthEmail } from '../lib/auth-flow-api';
import { getApiErrorMessage } from '../lib/api-client';
import { AuthStoreError, useAuthStore } from '../store/auth-store';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ verified?: string }>();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setErrorMessage('');
    setVerificationMessage('');
    setNeedsVerification(false);

    const normalizedEmail = normalizeAuthEmail(email);
    if (!isValidAuthEmail(normalizedEmail)) {
      setErrorMessage('请输入有效的邮箱地址。');
      return;
    }
    if (!password) {
      setErrorMessage('请输入密码。');
      return;
    }

    setSubmitting(true);
    try {
      await login(normalizedEmail, password);
      router.replace('/' as never);
    } catch (cause) {
      if (cause instanceof AuthStoreError && (cause.code === 'EMAIL_NOT_VERIFIED' || cause.status === 403)) {
        setNeedsVerification(true);
        setErrorMessage('这个邮箱还没有完成验证。请检查收件箱，或重新发送验证邮件。');
      } else {
        setErrorMessage(cause instanceof Error ? cause.message : '登录暂时无法完成，请检查网络后重试。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resendVerification = async () => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!isValidAuthEmail(normalizedEmail)) {
      setVerificationMessage('请先填写有效的注册邮箱。');
      return;
    }

    setResending(true);
    setVerificationMessage('');
    try {
      const { response, data } = await requestEmailVerification(normalizedEmail);
      if (response.ok) {
        setVerificationMessage('如果该邮箱对应尚未验证的账号，系统已受理验证邮件请求。请检查收件箱和垃圾邮件。');
      } else if (response.status === 429) {
        setVerificationMessage('请求过于频繁，请稍等片刻后重试。');
      } else if (response.status >= 500) {
        setVerificationMessage('验证邮件服务暂时不可用，请稍后重试。');
      } else {
        setVerificationMessage(getApiErrorMessage(data, '验证邮件请求未能完成，请稍后重试。', response.status));
      }
    } catch (cause) {
      setVerificationMessage(cause instanceof Error ? cause.message : '网络异常，验证邮件请求未能完成。');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthScreen title="登录 LuckRead" subtitle="继续阅读你关注的内容，与创作者和社区保持联系。">
      {params.verified === '1' ? <AuthMessage message="邮箱验证成功，现在可以登录了。" variant="success" /> : null}

      <AuthInput
        label="邮箱"
        accessibilityLabel="邮箱"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
        onChangeText={(value) => {
          setEmail(value);
          setNeedsVerification(false);
          setVerificationMessage('');
        }}
        placeholder="name@example.com"
        returnKeyType="next"
        textContentType="emailAddress"
        value={email}
      />
      <AuthInput
        label="密码"
        accessibilityLabel="密码"
        autoCapitalize="none"
        autoComplete="current-password"
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
        placeholder="输入密码"
        returnKeyType="go"
        secureTextEntry
        textContentType="password"
        value={password}
      />

      <View style={{ alignItems: 'flex-end', marginTop: -12, marginBottom: 8 }}>
        <AuthTextLink label="忘记密码？" onPress={() => router.push('/forgot-password' as never)} />
      </View>

      <AuthMessage message={errorMessage} />
      {needsVerification ? (
        <View style={{ marginBottom: 8 }}>
          <AuthSecondaryButton
            label={resending ? '正在发送验证邮件…' : '重新发送验证邮件'}
            onPress={() => void resendVerification()}
            disabled={resending}
          />
          <AuthMessage message={verificationMessage} variant="info" />
        </View>
      ) : null}

      <AuthPrimaryButton label="登录" busy={submitting} onPress={() => void submit()} />
      <View style={{ marginTop: 20 }}>
        <Text style={{ color: AUTH_COLORS.secondary, fontSize: 14, lineHeight: 21 }}>还没有账号？</Text>
        <AuthSecondaryButton label="创建账号" onPress={() => router.push('/register' as never)} />
      </View>

      <View style={{ marginTop: 14, alignItems: 'center' }}>
        <Pressable onPress={() => router.push('/verify-email' as never)} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: AUTH_COLORS.accent, fontSize: 13, fontWeight: '700' }}>收不到验证邮件？</Text>
        </Pressable>
      </View>

      <View style={{ marginTop: 22, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 }}>
        <Text style={{ color: '#8b98a5', fontSize: 12 }}>查看 LuckRead</Text>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://luckread.com/terms').catch(() => undefined)}>
          <Text style={{ color: AUTH_COLORS.accent, fontSize: 12, fontWeight: '700' }}>用户协议</Text>
        </Pressable>
        <Text style={{ color: '#8b98a5', fontSize: 12 }}>和</Text>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://luckread.com/privacy').catch(() => undefined)}>
          <Text style={{ color: AUTH_COLORS.accent, fontSize: 12, fontWeight: '700' }}>隐私政策</Text>
        </Pressable>
      </View>
    </AuthScreen>
  );
}
