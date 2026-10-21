import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export const AUTH_COLORS = {
  accent: '#1d9bf0',
  text: '#0f1419',
  secondary: '#536471',
  border: '#cfd9de',
  background: '#ffffff',
  error: '#b42318',
  errorBackground: '#fff1f0',
  success: '#067647',
  successBackground: '#ecfdf3',
} as const;

export function AuthScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            <Text accessibilityRole="header" style={styles.brand}>LuckRead</Text>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthInput({
  label,
  containerStyle,
  ...inputProps
}: TextInputProps & { label: string; containerStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.fieldContainer, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor="#8b98a5"
        selectionColor={AUTH_COLORS.accent}
        style={[styles.input, inputProps.editable === false ? styles.inputDisabled : null]}
      />
    </View>
  );
}

export function AuthPrimaryButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const unavailable = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        unavailable ? styles.buttonDisabled : null,
        pressed && !unavailable ? styles.buttonPressed : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function AuthSecondaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null,
      ]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function AuthTextLink({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.linkButton, pressed && !disabled ? { opacity: 0.65 } : null]}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

export function AuthMessage({
  message,
  variant = 'error',
}: {
  message: string;
  variant?: 'error' | 'success' | 'info';
}) {
  if (!message) return null;
  const variantStyle = variant === 'success'
    ? styles.successMessage
    : variant === 'info'
      ? styles.infoMessage
      : styles.errorMessage;
  const textStyle = variant === 'success'
    ? styles.successMessageText
    : variant === 'info'
      ? styles.infoMessageText
      : styles.errorMessageText;
  return (
    <View accessibilityRole={variant === 'error' ? 'alert' : 'text'} style={variantStyle} accessibilityLiveRegion="polite">
      <Text style={textStyle}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AUTH_COLORS.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  container: { width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: 24 },
  brand: { color: AUTH_COLORS.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, marginBottom: 28 },
  title: { color: AUTH_COLORS.text, fontSize: 29, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginBottom: 8 },
  subtitle: { color: AUTH_COLORS.secondary, fontSize: 15, lineHeight: 22, marginBottom: 24 },
  fieldContainer: { marginBottom: 16 },
  label: { color: AUTH_COLORS.text, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: '#ffffff',
    borderColor: AUTH_COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    color: AUTH_COLORS.text,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  inputDisabled: { backgroundColor: '#f7f9f9', color: '#536471' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: AUTH_COLORS.accent,
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 8,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: AUTH_COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 18,
  },
  secondaryButtonText: { color: AUTH_COLORS.text, fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.78 },
  linkButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 36, paddingVertical: 5 },
  linkText: { color: AUTH_COLORS.accent, fontSize: 14, fontWeight: '700' },
  errorMessage: { borderColor: '#fecdca', borderRadius: 10, borderWidth: 1, backgroundColor: AUTH_COLORS.errorBackground, padding: 12, marginBottom: 12 },
  errorMessageText: { color: AUTH_COLORS.error, fontSize: 14, lineHeight: 20 },
  successMessage: { borderColor: '#abefc6', borderRadius: 10, borderWidth: 1, backgroundColor: AUTH_COLORS.successBackground, padding: 12, marginBottom: 12 },
  successMessageText: { color: AUTH_COLORS.success, fontSize: 14, lineHeight: 20 },
  infoMessage: { borderColor: AUTH_COLORS.border, borderRadius: 10, borderWidth: 1, backgroundColor: '#f7f9f9', padding: 12, marginBottom: 12 },
  infoMessageText: { color: AUTH_COLORS.secondary, fontSize: 14, lineHeight: 20 },
});
