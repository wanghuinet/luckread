import { Platform } from 'react-native';
import Hyperswitch, {
  type HyperswitchSession,
  type PaymentResult,
} from '@juspay-tech/react-native-hyperswitch';

type NativeEnvironment = 'PROD' | 'SANDBOX';

type NativeConfiguration = {
  publishableKey: string;
  environment: NativeEnvironment;
};

let activeConfigurationKey: string | null = null;
let activeSession: Promise<HyperswitchSession> | null = null;

function readConfiguration(): NativeConfiguration {
  const publishableKey = process.env.EXPO_PUBLIC_HYPERSWITCH_PUBLISHABLE_KEY?.trim() ?? '';
  const environment = process.env.EXPO_PUBLIC_HYPERSWITCH_ENVIRONMENT?.trim().toUpperCase() ?? '';
  if (!publishableKey || (environment !== 'PROD' && environment !== 'SANDBOX')) {
    throw new Error('Hyperswitch 公钥或明确的 sandbox/production 环境配置缺失，支付入口已安全关闭。');
  }
  return { publishableKey, environment };
}

/** Fail before creating an order when the native provider configuration is absent. */
export function assertNativeHyperswitchConfigured(): void {
  if (Platform.OS === 'web') {
    throw new Error('当前支付入口仅适用于已安装原生支付模块的 LuckRead APP。');
  }
  readConfiguration();
}

async function getHyperswitchSession(configuration: NativeConfiguration): Promise<HyperswitchSession> {
  const key = configuration.environment + ':' + configuration.publishableKey;
  if (activeSession && activeConfigurationKey === key) return activeSession;

  activeConfigurationKey = key;
  const pending = Hyperswitch.init({
    publishableKey: configuration.publishableKey,
    environment: configuration.environment,
  });
  activeSession = pending;
  try {
    return await pending;
  } catch (error) {
    if (activeSession === pending) {
      activeSession = null;
      activeConfigurationKey = null;
    }
    throw error;
  }
}

/**
 * Show the provider-owned native payment sheet. The SDK result is informational
 * only; W07's verified provider webhook/reconciliation remains authoritative.
 */
export async function presentNativeMembershipPayment(
  sdkAuthorization: string,
): Promise<PaymentResult> {
  if (Platform.OS === 'web') {
    throw new Error('原生 Hyperswitch 支付表单不能在 Web 运行环境中启动。');
  }
  if (
    typeof sdkAuthorization !== 'string' ||
    sdkAuthorization.length < 1 ||
    sdkAuthorization.length > 4096 ||
    sdkAuthorization.trim() !== sdkAuthorization ||
    /[\u0000-\u001f\u007f]/.test(sdkAuthorization)
  ) {
    throw new TypeError('Hyperswitch 原生支付会话凭证无效。');
  }

  const configuration = readConfiguration();
  const hyperswitch = await getHyperswitchSession(configuration);
  const paymentSession = await hyperswitch.initPaymentSession({ sdkAuthorization });
  return paymentSession.presentPaymentSheet({
    merchantDisplayName: 'LuckRead',
    displaySavedPaymentMethodsCheckbox: true,
    appearance: { theme: 'Light' },
    locale: 'en',
  });
}
