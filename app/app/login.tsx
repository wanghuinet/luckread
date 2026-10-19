import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { getApiErrorMessage } from '../lib/api-client';
import { useAuthStore } from '../store/auth-store';

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const [identity, setIdentity] = useState('');
  const [credential, setCredential] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const submit = async () => {
    if (submitting) return;
    setErrorMessage('');
    setSubmitting(true);
    try {
      await login(identity, credential);
      router.replace('/' as never);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : getApiErrorMessage(error, 'Unable to sign in. Please try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.brand}>LuckRead</Text>
          <Text style={styles.title}>Sign in to LuckRead</Text>
          <Text style={styles.subtitle}>
            Use your LuckRead account to view your timeline and follow creators.
          </Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={setIdentity}
            onSubmitEditing={() => undefined}
            placeholder="you@example.com"
            placeholderTextColor="#7b8794"
            returnKeyType="next"
            style={styles.input}
            textContentType="emailAddress"
            value={identity}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="password"
            onChangeText={setCredential}
            onSubmitEditing={() => void submit()}
            placeholder="Password"
            placeholderTextColor="#7b8794"
            returnKeyType="go"
            secureTextEntry
            style={styles.input}
            textContentType="password"
            value={credential}
          />

          {errorMessage ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {errorMessage}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={submitting || !identity.trim() || !credential}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.button,
              (submitting || !identity.trim() || !credential) && styles.buttonDisabled,
              pressed && !submitting ? styles.buttonPressed : null,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          <Text style={styles.footnote}>
            Your session credential is stored in platform-secure storage.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ffffff' },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 30 },
  brand: { color: '#1769aa', fontSize: 19, fontWeight: '800', marginBottom: 20 },
  title: { color: '#101828', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#667085', fontSize: 15, lineHeight: 22, marginBottom: 28 },
  label: { color: '#344054', fontSize: 14, fontWeight: '700', marginBottom: 8, marginTop: 14 },
  input: {
    borderColor: '#d0d5dd',
    borderRadius: 12,
    borderWidth: 1,
    color: '#101828',
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  error: { color: '#b42318', fontSize: 14, lineHeight: 20, marginTop: 14 },
  button: {
    alignItems: 'center',
    backgroundColor: '#1769aa',
    borderRadius: 999,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 50,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  footnote: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 20, textAlign: 'center' },
});
