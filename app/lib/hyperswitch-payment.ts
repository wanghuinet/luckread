/** Stable cross-platform result shape; the Web stub and native SDK expose the same states. */
export type NativeMembershipPaymentResult = Readonly<{
  status: 'completed' | 'canceled' | 'failed';
}>;

/** Web fallback for the native-only Hyperswitch SDK. */
export function assertNativeHyperswitchConfigured(): void {
  throw new Error('当前 Web 运行环境不包含原生 Hyperswitch 支付模块，请在 LuckRead 原生 APP 中完成支付。');
}

export async function presentNativeMembershipPayment(_sdkAuthorization: string): Promise<NativeMembershipPaymentResult> {
  throw new Error('当前 Web 运行环境不包含原生 Hyperswitch 支付模块，请在 LuckRead 原生 APP 中完成支付。');
}
