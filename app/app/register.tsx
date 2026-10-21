import React, { useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  AuthInput,
  AuthMessage,
  AuthPrimaryButton,
  AuthScreen,
  AuthSecondaryButton,
  AuthTextLink,
  AUTH_COLORS,
} from '../components/auth/AuthScreen';
import { createIdempotencyKey, getApiErrorMessage } from '../lib/api-client';
import {
  isValidAuthEmail,
  isValidAuthPassword,
  isValidAuthUsername,
  normalizeAuthEmail,
  readAuthApiErrorCode,
  registerWithEmail,
  requestEmailVerification,
} from '../lib/auth-flow-api';

type RegistrationState = 'idle' | 'submitting' | 'success' | 'error';
type VerificationState = 'idle' | 'sending' | 'accepted' | 'error';

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [registrationState, setRegistrationState] = useState<RegistrationState>('idle');
  const [verificationState, setVerificationState] = useState<VerificationState>('idle');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [emailConflict, setEmailConflict] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');
  const idempotencyKeyRef = useRef<string | null>(null);

  const openPolicy = (url: string) => {
    void Linking.openURL(url).catch(() => {
      setErrorMessage('暂时无法打开协议页面，请稍后通过 luckread.com 查看。');
    });
  };

  const sendVerification = async (identity: string) => {
    setVerificationState('sending');
    setVerificationMessage('');
    try {
      const { response, data } = await requestEmailVerification(identity);
      if (response.ok) {
        setVerificationState('accepted');
        setVerificationMessage('如果该邮箱尚未验证，系统已受理验证邮件请求。邮件可能需要几分钟到达，请同时检查垃圾邮件。');
      } else if (response.status === 429) {
        setVerificationState('error');
        setVerificationMessage('验证邮件请求过于频繁，请稍后重试。');
      } else if (response.status >= 500) {
        setVerificationState('error');
        setVerificationMessage('账号已创建，但验证邮件服务暂时不可用。请稍后重试。');
      } else {
        setVerificationState('error');
        setVerificationMessage(getApiErrorMessage(data, '验证邮件请求未能完成，请稍后重试。', response.status));
      }
    } catch (cause) {
      setVerificationState('error');
      setVerificationMessage(cause instanceof Error ? cause.message : '网络异常，验证邮件请求未能完成。');
    }
  };

  const submit = async () => {
    if (registrationState === 'submitting') return;
    setErrorMessage('');
    setEmailConflict(false);

    const normalizedEmail = normalizeAuthEmail(email);
    const normalizedUsername = username.trim();
    if (!isValidAuthEmail(normalizedEmail)) {
      setRegistrationState('error');
      setErrorMessage('请输入有效的邮箱地址。');
      return;
    }
    if (!isValidAuthUsername(normalizedUsername)) {
      setRegistrationState('error');
      setErrorMessage('用户名需为 6–32 位英文字母或数字，不能包含空格或特殊字符。');
      return;
    }
    if (!isValidAuthPassword(password)) {
      setRegistrationState('error');
      setErrorMessage('密码长度必须为 15–128 个字符。请使用较长且独一无二的密码。');
      return;
    }
    if (!confirmPassword) {
      setRegistrationState('error');
      setErrorMessage('请再次输入密码以完成确认。');
      return;
    }
    if (password !== confirmPassword) {
      setRegistrationState('error');
      setErrorMessage('两次输入的密码不一致。');
      return;
    }
    if (!consent) {
      setRegistrationState('error');
      setErrorMessage('请先同意 LuckRead 用户协议和隐私政策。');
      return;
    }

    setRegistrationState('submitting');
    try {
      idempotencyKeyRef.current ||= createIdempotencyKey();
      const { response, data } = await registerWithEmail({
        email: normalizedEmail,
        username: normalizedUsername,
        password,
        idempotencyKey: idempotencyKeyRef.current,
      });

      if (!response.ok) {
        const code = readAuthApiErrorCode(data);
        // Only keep a key when a request may have committed but its result is
        // uncertain (in-progress, rate-limited, or service/transport failure).
        // A known input/identity conflict must not reuse that key after edits.
        if (response.status < 500 && response.status !== 409 && response.status !== 429) {
          idempotencyKeyRef.current = null;
        }
        if (code === 'EMAIL_ALREADY_REGISTERED' || code === 'EMAIL_TAKEN' || code === 'USER_ALREADY_EXISTS') {
          idempotencyKeyRef.current = null;
          setEmailConflict(true);
          throw new Error('该邮箱可能已注册。请尝试登录，或使用忘记密码找回账号。');
        }
        if (code === 'USERNAME_TAKEN' || code === 'USERNAME_ALREADY_EXISTS') {
          idempotencyKeyRef.current = null;
          throw new Error('该用户名已被使用，请换一个用户名。');
        }
        if (response.status === 429) {
          throw new Error('注册请求过于频繁，请稍等片刻后重试。');
        }
        if (response.status >= 500) {
          throw new Error('注册服务暂时不可用。为避免重复创建账号，请稍后使用相同信息重试。');
        }
        throw new Error(getApiErrorMessage(data, '注册信息未通过校验，请检查后重试。', response.status));
      }

      const result = data as { userId?: unknown; accountState?: unknown } | null;
      if (
        response.status !== 201 ||
        !result ||
        typeof result.userId !== 'string' ||
        result.accountState !== 'PENDING_VERIFICATION'
      ) {
        throw new Error('注册结果暂时无法确认。请稍后使用相同信息重试。');
      }

      idempotencyKeyRef.current = null;
      setRegisteredEmail(normalizedEmail);
      setEmail('');
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setConsent(false);
      setRegistrationState('success');
      await sendVerification(normalizedEmail);
    } catch (cause) {
      setRegistrationState('error');
      setErrorMessage(cause instanceof Error ? cause.message : '注册暂时无法完成，请稍后重试。');
    }
  };

  if (registrationState === 'success') {
    return (
      <AuthScreen title="检查你的邮箱" subtitle="账号已创建。完成邮箱验证后，就可以登录 LuckRead。">
        <AuthMessage message="账号创建成功" variant="success" />
        <View style={{ borderWidth: 1, borderColor: '#cfd9de', borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <Text style={{ color: AUTH_COLORS.secondary, fontSize: 13, marginBottom: 5 }}>验证邮件发送至</Text>
          <Text accessibilityRole="text" style={{ color: AUTH_COLORS.text, fontSize: 16, fontWeight: '700' }}>
            {registeredEmail}
          </Text>
        </View>
        <AuthMessage
          message={verificationMessage || '请检查收件箱和垃圾邮件。打开邮件中的验证链接后，再返回登录。'}
          variant={verificationState === 'error' ? 'error' : 'info'}
        />
        <AuthPrimaryButton
          label={verificationState === 'sending' ? '正在发送…' : verificationState === 'accepted' ? '重新发送验证邮件' : '发送验证邮件'}
          busy={verificationState === 'sending'}
          onPress={() => void sendVerification(registeredEmail)}
        />
        <AuthSecondaryButton label="返回登录" onPress={() => router.replace('/login' as never)} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="创建你的账号" subtitle="加入 LuckRead，关注创作者、发布动态并参与讨论。">
      <AuthInput
        label="邮箱地址"
        accessibilityLabel="邮箱地址"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        maxLength={254}
        onChangeText={setEmail}
        placeholder="name@example.com"
        returnKeyType="next"
        textContentType="emailAddress"
        value={email}
        editable={registrationState !== 'submitting'}
      />
      <AuthInput
        label="用户名"
        accessibilityLabel="用户名"
        autoCapitalize="none"
        autoComplete="username"
        autoCorrect={false}
        maxLength={32}
        onChangeText={setUsername}
        placeholder="6–32 位英文字母或数字"
        returnKeyType="next"
        value={username}
        editable={registrationState !== 'submitting'}
      />
      <Text style={{ color: AUTH_COLORS.secondary, fontSize: 12, lineHeight: 18, marginTop: -9, marginBottom: 14 }}>
        用户名会显示在你的公开主页中。
      </Text>
      <AuthInput
        label="密码"
        accessibilityLabel="密码"
        autoCapitalize="none"
        autoComplete="new-password"
        maxLength={128}
        onChangeText={setPassword}
        placeholder="15–128 个字符"
        returnKeyType="next"
        secureTextEntry
        textContentType="newPassword"
        value={password}
        editable={registrationState !== 'submitting'}
      />
      <AuthInput
        label="确认密码"
        accessibilityLabel="确认密码"
        autoCapitalize="none"
        autoComplete="new-password"
        maxLength={128}
        onChangeText={setConfirmPassword}
        onSubmitEditing={() => void submit()}
        placeholder="再次输入密码"
        returnKeyType="go"
        secureTextEntry
        textContentType="newPassword"
        value={confirmPassword}
        editable={registrationState !== 'submitting'}
      />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent, disabled: registrationState === 'submitting' }}
        disabled={registrationState === 'submitting'}
        onPress={() => setConsent((value) => !value)}
        style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 10, marginTop: 2, marginBottom: 6 }}
      >
        <View style={{
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: consent ? AUTH_COLORS.accent : AUTH_COLORS.border,
          backgroundColor: consent ? AUTH_COLORS.accent : '#ffffff',
        }}>
          {consent ? <Text style={{ color: '#ffffff', fontWeight: '900', fontSize: 14 }}>✓</Text> : null}
        </View>
        <Text style={{ flex: 1, color: AUTH_COLORS.secondary, fontSize: 13, lineHeight: 20 }}>
          我已阅读并同意 LuckRead 的用户协议和隐私政策。
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }}>
        <AuthTextLink label="用户协议" onPress={() => openPolicy('https://luckread.com/terms')} />
        <Text style={{ color: AUTH_COLORS.secondary }}>·</Text>
        <AuthTextLink label="隐私政策" onPress={() => openPolicy('https://luckread.com/privacy')} />
      </View>

      <AuthMessage message={errorMessage} />
      {emailConflict ? (
        <View style={{ marginBottom: 8 }}>
          <AuthSecondaryButton label="前往登录" onPress={() => router.push('/login' as never)} />
          <AuthTextLink label="忘记密码？" onPress={() => router.push('/forgot-password' as never)} />
        </View>
      ) : null}
      <AuthPrimaryButton
        label="创建账号"
        busy={registrationState === 'submitting'}
        onPress={() => void submit()}
      />

      <View style={{ marginTop: 16, alignItems: 'center' }}>
        <Text style={{ color: AUTH_COLORS.secondary, fontSize: 14 }}>已经有账号？</Text>
        <AuthTextLink label="登录" onPress={() => router.replace('/login' as never)} />
      </View>
      <Text style={{ color: '#8b98a5', fontSize: 12, lineHeight: 18, marginTop: 18, textAlign: 'center' }}>
        当前支持邮箱注册和验证；手机号及第三方登录暂未开放。
      </Text>
    </AuthScreen>
  );
}
