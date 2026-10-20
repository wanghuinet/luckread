import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError, login } from '~/lib/luckread-api';

export default function LoginScreen() {
  const router = useRouter();
  const [identity, setIdentity] = useState('');
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!identity.trim() || !credential) {
      setError('请输入邮箱和密码。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(identity, credential);
      router.replace('/real-feed');
    } catch (e) {
      const err = e as ApiError;
      setError(err.code === 'EMAIL_NOT_VERIFIED'
        ? '该邮箱尚未验证，请先完成邮箱验证。'
        : err.message || '登录失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <KeyboardAvoidingView className="flex-1 justify-center px-6" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="mb-8">
          <Text className="text-3xl font-bold text-black dark:text-white">登录 LuckRead</Text>
          <Text className="mt-2 text-base text-neutral-500">登录后查看你关注的创作者动态。</Text>
        </View>
        <TextInput
          accessibilityLabel="邮箱"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={identity}
          onChangeText={setIdentity}
          placeholder="邮箱地址"
          placeholderTextColor="#8a8a8a"
          className="mb-3 rounded-xl border border-neutral-300 px-4 py-3 text-base text-black dark:border-neutral-700 dark:text-white"
          editable={!busy}
        />
        <TextInput
          accessibilityLabel="密码"
          autoCapitalize="none"
          autoComplete="current-password"
          secureTextEntry
          value={credential}
          onChangeText={setCredential}
          onSubmitEditing={submit}
          placeholder="密码"
          placeholderTextColor="#8a8a8a"
          className="mb-4 rounded-xl border border-neutral-300 px-4 py-3 text-base text-black dark:border-neutral-700 dark:text-white"
          editable={!busy}
        />
        {!!error && <Text accessibilityRole="alert" className="mb-4 text-sm text-red-600">{error}</Text>}
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={submit} className="items-center rounded-full bg-sky-500 px-4 py-3">
          {busy ? <ActivityIndicator color="#fff" /> : <Text className="font-bold text-white">登录</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
