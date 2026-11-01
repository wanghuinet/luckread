import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { createIdempotencyKey, getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import {
  createMembershipPaymentIntent,
  createSubscriptionPlanUpgradeCheckout,
  fetchActiveMembershipPlansPage,
  fetchMySubscription,
  fetchSubscriptionPlanChangePreview,
  scheduleSubscriptionBillingIntervalChange,
  scheduleSubscriptionPlanDowngrade,
  type ActiveMembershipPlan,
  type ActiveMembershipPlanPage,
  type MySubscription,
  type ScheduledSubscriptionPlanChange,
  type SubscriptionPlanChangePreview,
  type SubscriptionPlanUpgradeCheckout,
} from '~/lib/subscriptions-api';
import { assertNativeHyperswitchConfigured, presentNativeMembershipPayment } from '~/lib/hyperswitch-payment';
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';
const PAGE_SIZE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlan(value: unknown): value is ActiveMembershipPlan {
  if (!isRecord(value)) return false;
  return typeof value.planId === 'string' && /^plan_[a-f0-9]{64}$/.test(value.planId) &&
    typeof value.creatorId === 'string' && value.creatorId.length > 0 &&
    typeof value.planVersion === 'number' && Number.isSafeInteger(value.planVersion) && value.planVersion > 0 &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 120 &&
    typeof value.tier === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value.tier) &&
    (value.billingInterval === 'MONTHLY' || value.billingInterval === 'YEARLY') &&
    typeof value.priceMinor === 'number' && Number.isSafeInteger(value.priceMinor) &&
    value.priceMinor > 0 && value.priceMinor <= 2_147_483_647 &&
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) &&
    Array.isArray(value.benefits) && value.benefits.length <= 20 &&
    value.benefits.every((benefit) => typeof benefit === 'string' && benefit.trim() === benefit &&
      benefit.length > 0 && benefit.length <= 180);
}

function isPlanPage(value: unknown): value is ActiveMembershipPlanPage {
  return isRecord(value) && typeof value.limit === 'number' &&
    Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= PAGE_SIZE &&
    Array.isArray(value.docs) && value.docs.length <= value.limit && value.docs.every(isPlan) &&
    typeof value.hasMore === 'boolean' &&
    (value.hasMore
      ? typeof value.nextCursor === 'string' && value.nextCursor.length > 0 && value.nextCursor.length <= 2048
      : value.nextCursor === null);
}

function isSubscription(value: unknown): value is MySubscription {
  return isRecord(value) &&
    typeof value.subscriptionId === 'string' && /^sub_[A-Za-z0-9_-]{1,128}$/.test(value.subscriptionId) &&
    typeof value.subscriberId === 'string' &&
    typeof value.planId === 'string' && /^plan_[a-f0-9]{64}$/.test(value.planId) &&
    typeof value.planVersion === 'number' && Number.isSafeInteger(value.planVersion) && value.planVersion > 0 &&
    (value.creatorId === null || typeof value.creatorId === 'string') &&
    ['PENDING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED'].includes(String(value.status)) &&
    typeof value.currentPeriodStart === 'string' && Number.isFinite(Date.parse(value.currentPeriodStart)) &&
    typeof value.currentPeriodEnd === 'string' && Number.isFinite(Date.parse(value.currentPeriodEnd)) &&
    typeof value.etag === 'string' && /^"lr-v([1-9]\d*)"$/.test(value.etag);
}

function isPlanSnapshot(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.planId === 'string' && /^plan_[a-f0-9]{64}$/.test(value.planId) &&
    typeof value.planVersion === 'number' && Number.isSafeInteger(value.planVersion) && value.planVersion > 0 &&
    typeof value.name === 'string' && value.name.length > 0 &&
    typeof value.tier === 'string' &&
    (value.billingInterval === 'MONTHLY' || value.billingInterval === 'YEARLY') &&
    typeof value.priceMinor === 'number' && Number.isSafeInteger(value.priceMinor) && value.priceMinor >= 0 &&
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency);
}

function isPreview(value: unknown): value is SubscriptionPlanChangePreview {
  return isRecord(value) &&
    typeof value.subscriptionId === 'string' &&
    typeof value.currentPeriodStart === 'string' && Number.isFinite(Date.parse(value.currentPeriodStart)) &&
    typeof value.currentPeriodEnd === 'string' && Number.isFinite(Date.parse(value.currentPeriodEnd)) &&
    isPlanSnapshot(value.currentPlan) && isPlanSnapshot(value.targetPlan) &&
    ['NO_CHANGE', 'UPGRADE', 'DOWNGRADE', 'BILLING_INTERVAL_CHANGE', 'SAME_PRICE_CHANGE'].includes(String(value.changeType)) &&
    typeof value.effectiveAt === 'string' && Number.isFinite(Date.parse(value.effectiveAt)) &&
    typeof value.prorationBaseMinor === 'number' && Number.isSafeInteger(value.prorationBaseMinor) && value.prorationBaseMinor >= 0 &&
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) &&
    typeof value.paymentRequired === 'boolean' &&
    value.prorationBasis === 'LIST_PRICE_DIFFERENCE_BEFORE_DISCOUNTS_AND_TAX' &&
    value.pricingFinalized === false &&
    typeof value.remainingPeriodMs === 'number' && Number.isSafeInteger(value.remainingPeriodMs) &&
    typeof value.periodDurationMs === 'number' && Number.isSafeInteger(value.periodDurationMs) &&
    typeof value.computedAt === 'string' && Number.isFinite(Date.parse(value.computedAt)) &&
    typeof value.etag === 'string' && /^"lr-v([1-9]\d*)"$/.test(value.etag);
}

function isUpgradeCheckout(value: unknown): value is SubscriptionPlanUpgradeCheckout {
  if (!isRecord(value) || !isRecord(value.order) || !isRecord(value.proration)) return false;
  return typeof value.attemptId === 'string' && /^suca_[a-f0-9]{64}$/.test(value.attemptId) &&
    typeof value.subscriptionId === 'string' &&
    (value.status === 'PENDING_PAYMENT' || value.status === 'APPLIED') &&
    typeof value.order.orderId === 'string' && /^ord_[A-Za-z0-9_-]{1,90}$/.test(value.order.orderId) &&
    typeof value.order.status === 'string' &&
    typeof value.order.totalMinor === 'number' && Number.isSafeInteger(value.order.totalMinor) && value.order.totalMinor > 0 &&
    typeof value.order.currency === 'string' && /^[A-Z]{3}$/.test(value.order.currency) &&
    typeof value.proration.amountMinor === 'number' && Number.isSafeInteger(value.proration.amountMinor) &&
    value.proration.amountMinor > 0 && value.proration.currency === value.order.currency &&
    value.proration.basis === 'LIST_PRICE_DIFFERENCE_BEFORE_DISCOUNTS_AND_TAX' &&
    value.proration.pricingFinalized === true &&
    (value.effectiveAt === null || typeof value.effectiveAt === 'string') &&
    typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)) &&
    typeof value.replayed === 'boolean';
}

function isScheduledChange(value: unknown): value is ScheduledSubscriptionPlanChange {
  return isRecord(value) &&
    typeof value.changeId === 'string' && /^sudc_[a-f0-9]{64}$/.test(value.changeId) &&
    typeof value.subscriptionId === 'string' &&
    (value.status === 'SCHEDULED' || value.status === 'APPLIED') &&
    (value.changeType === 'DOWNGRADE' || value.changeType === 'BILLING_INTERVAL_CHANGE') &&
    typeof value.currentPlanId === 'string' && /^plan_[a-f0-9]{64}$/.test(value.currentPlanId) &&
    typeof value.targetPlanId === 'string' && /^plan_[a-f0-9]{64}$/.test(value.targetPlanId) &&
    typeof value.targetPlanVersion === 'number' && Number.isSafeInteger(value.targetPlanVersion) &&
    typeof value.effectiveAt === 'string' && Number.isFinite(Date.parse(value.effectiveAt)) &&
    typeof value.replayed === 'boolean';
}

function isPaymentIntent(value: unknown, orderId: string, amountMinor: number, currency: string): value is {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  pricingMode: 'live' | 'demo';
  status: 'requires_payment_method' | 'requires_confirmation';
  version: number;
  clientSecret: string;
  sdkAuthorization: string;
} {
  if (!isRecord(value) || Object.keys(value).length !== 9) return false;
  return typeof value.paymentId === 'string' && /^pay_[a-f0-9]{26}$/.test(value.paymentId) &&
    value.orderId === orderId && value.amountMinor === amountMinor && value.currency === currency &&
    (value.pricingMode === 'live' || value.pricingMode === 'demo') &&
    (value.status === 'requires_payment_method' || value.status === 'requires_confirmation') &&
    typeof value.version === 'number' && Number.isSafeInteger(value.version) &&
    typeof value.clientSecret === 'string' &&
    typeof value.sdkAuthorization === 'string' && value.sdkAuthorization.length > 0 &&
    value.sdkAuthorization.length <= 4096 && value.sdkAuthorization.trim() === value.sdkAuthorization &&
    !/[\u0000-\u001f\u007f]/.test(value.sdkAuthorization);
}

function formatPrice(priceMinor: number, currency: string): string {
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(priceMinor / (10 ** digits));
  } catch {
    return currency + ' ' + String(priceMinor);
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '—';
}

function planInterval(value: 'MONTHLY' | 'YEARLY'): string {
  return value === 'MONTHLY' ? '每月' : '每年';
}

export default function SubscriptionChangeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ subscriptionId?: string | string[] }>();
  const rawSubscriptionId = Array.isArray(params.subscriptionId) ? params.subscriptionId[0] : params.subscriptionId;
  const subscriptionId = typeof rawSubscriptionId === 'string' ? rawSubscriptionId : '';
  const authStatus = useAuthStore((state) => state.status);

  const [subscription, setSubscription] = useState<MySubscription | null>(null);
  const [plans, setPlans] = useState<ActiveMembershipPlan[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMorePlans, setHasMorePlans] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SubscriptionPlanChangePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const idempotencyKeysRef = useRef(new Map<string, string>());

  const availablePlans = useMemo(() => plans.filter((plan) =>
    subscription?.creatorId !== null &&
    subscription?.creatorId !== undefined &&
    plan.creatorId === subscription.creatorId &&
    plan.planId !== subscription.planId &&
    plan.priceMinor > 0
  ), [plans, subscription?.creatorId, subscription?.planId]);

  const readFailure = useCallback((result: { response: Response; data: unknown; error?: { message?: string } | null }, fallback: string) => {
    return result.error?.message || getApiErrorMessage(result.data, fallback, result.response.status);
  }, []);

  const loadSubscription = useCallback(async (signal?: AbortSignal) => {
    if (!subscriptionId) throw new Error('订阅 ID 无效，请从“我的订阅”重新进入。');
    const result = await fetchMySubscription(subscriptionId, { signal });
    if (!result.response.ok) throw new Error(readFailure(result, '无法读取订阅详情。'));
    const payload = unwrapApiData<unknown>(result.data);
    if (!isSubscription(payload)) throw new Error('订阅服务返回的数据格式无效。');
    setSubscription(payload);
    return payload;
  }, [readFailure, subscriptionId]);

  const loadPlans = useCallback(async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
    if (append) setLoadingPlans(true);
    const result = await fetchActiveMembershipPlansPage({ limit: PAGE_SIZE, cursor, signal });
    if (!result.response.ok) throw new Error(readFailure(result, '会员方案读取失败。'));
    const payload = unwrapApiData<unknown>(result.data);
    if (!isPlanPage(payload)) throw new Error('会员方案服务返回的数据格式无效。');
    setPlans((current) => {
      if (!append) return payload.docs;
      const known = new Set(current.map((plan) => plan.planId));
      return [...current, ...payload.docs.filter((plan) => !known.has(plan.planId))];
    });
    setNextCursor(payload.nextCursor);
    setHasMorePlans(payload.hasMore);
  }, [readFailure]);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    setMessage('');
    setPreview(null);
    setSelectedPlanId(null);
    try {
      await Promise.all([
        loadSubscription(controller.signal),
        loadPlans(null, false, controller.signal),
      ]);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '订阅信息读取失败。');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [loadPlans, loadSubscription]);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setAuthRequired(true);
      setLoading(false);
      return;
    }
    setAuthRequired(false);
    void refresh();
    return () => {
      requestRef.current?.abort();
      previewRequestRef.current?.abort();
    };
  }, [authStatus, refresh]);

  const selectPlan = useCallback(async (plan: ActiveMembershipPlan) => {
    if (!subscription || busy) return;
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    setSelectedPlanId(plan.planId);
    setPreview(null);
    setMessage('');
    setError('');
    setLoadingPreview(true);
    try {
      const result = await fetchSubscriptionPlanChangePreview(subscription.subscriptionId, plan.planId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result.response.ok) throw new Error(readFailure(result, '无法计算套餐变更报价。'));
      const payload = unwrapApiData<unknown>(result.data);
      if (!isPreview(payload) || payload.subscriptionId !== subscription.subscriptionId ||
          payload.targetPlan.planId !== plan.planId || payload.etag !== subscription.etag) {
        throw new Error('套餐变更报价与当前订阅版本不匹配，请刷新后重试。');
      }
      setPreview(payload);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '套餐报价读取失败。');
    } finally {
      if (previewRequestRef.current === controller) previewRequestRef.current = null;
      if (!controller.signal.aborted) setLoadingPreview(false);
    }
  }, [busy, readFailure, subscription]);

  const getIdempotencyKey = useCallback((kind: string, planId: string, etag: string) => {
    const identity = [subscriptionId, kind, planId, etag].join(':');
    const existing = idempotencyKeysRef.current.get(identity);
    if (existing) return existing;
    const created = createIdempotencyKey();
    idempotencyKeysRef.current.set(identity, created);
    return created;
  }, [subscriptionId]);

  const executeChange = useCallback(async () => {
    if (!subscription || !preview || !selectedPlanId || busy) return;
    if (preview.etag !== subscription.etag || preview.currentPlan.planId !== subscription.planId) {
      setError('订阅版本已发生变化，请刷新后重新选择套餐。');
      return;
    }
    const targetPlan = availablePlans.find((plan) => plan.planId === selectedPlanId);
    if (!targetPlan) {
      setError('目标套餐已不在可选目录中，请刷新方案列表。');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (preview.changeType === 'UPGRADE' && preview.paymentRequired) {
        // Do not create an upgrade reservation or order if the native SDK is not installed/configured.
        assertNativeHyperswitchConfigured();
        const checkoutResult = await createSubscriptionPlanUpgradeCheckout(
          subscription.subscriptionId,
          targetPlan.planId,
          preview.etag,
          getIdempotencyKey('upgrade', targetPlan.planId, preview.etag),
        );
        if (!checkoutResult.response.ok) {
          throw new Error(readFailure(checkoutResult, '升级结账暂时无法启动。'));
        }
        const checkout = unwrapApiData<unknown>(checkoutResult.data);
        if (!isUpgradeCheckout(checkout) || checkout.subscriptionId !== subscription.subscriptionId) {
          throw new Error('升级结账服务返回了无效订单，支付已停止。');
        }
        if (checkout.status === 'APPLIED') {
          setMessage('服务端已确认该次升级完成。会员权益状态以 W07/W03 的最新授权结果为准。');
          await loadSubscription();
          return;
        }

        const intentResult = await createMembershipPaymentIntent(checkout.order.orderId);
        if (!intentResult.response.ok) {
          throw new Error(readFailure(intentResult, '升级付款会话创建失败。'));
        }
        const intent = unwrapApiData<unknown>(intentResult.data);
        if (!isPaymentIntent(intent, checkout.order.orderId, checkout.order.totalMinor, checkout.order.currency)) {
          throw new Error('支付服务未返回与升级订单匹配的有效 Hyperswitch 会话，支付已停止。');
        }
        const paymentResult = await presentNativeMembershipPayment(intent.sdkAuthorization);
        if (paymentResult.status === 'completed') {
          setMessage('支付表单已提交。LuckRead 正在等待 Hyperswitch 签名 Webhook 与 W07 履约确认；在服务端确认前，当前套餐和会员权益不会被客户端回调修改。');
          await loadSubscription();
        } else if (paymentResult.status === 'canceled') {
          setMessage('你已取消本次升级付款，原订阅和权益保持不变。');
        } else {
          setMessage('本次升级付款未完成，原订阅和权益保持不变。请核对付款方式后重试。');
        }
        return;
      }

      if (preview.changeType === 'DOWNGRADE' && !preview.paymentRequired) {
        const result = await scheduleSubscriptionPlanDowngrade(
          subscription.subscriptionId,
          targetPlan.planId,
          preview.etag,
          getIdempotencyKey('downgrade', targetPlan.planId, preview.etag),
        );
        if (!result.response.ok) throw new Error(readFailure(result, '降级排期失败。'));
        const payload = unwrapApiData<unknown>(result.data);
        if (!isScheduledChange(payload) || payload.changeType !== 'DOWNGRADE' ||
            payload.subscriptionId !== subscription.subscriptionId || payload.targetPlanId !== targetPlan.planId) {
          throw new Error('服务端未返回有效的降级排期确认。');
        }
        setMessage(payload.status === 'APPLIED'
          ? '服务端已确认该套餐变更完成。'
          : '降级已排期，将于 ' + formatDate(payload.effectiveAt) + ' 生效；当前周期内仍保留原套餐及权益。');
        return;
      }

      if (preview.changeType === 'BILLING_INTERVAL_CHANGE' && !preview.paymentRequired) {
        const result = await scheduleSubscriptionBillingIntervalChange(
          subscription.subscriptionId,
          targetPlan.planId,
          preview.etag,
          getIdempotencyKey('interval', targetPlan.planId, preview.etag),
        );
        if (!result.response.ok) throw new Error(readFailure(result, '计费周期变更排期失败。'));
        const payload = unwrapApiData<unknown>(result.data);
        if (!isScheduledChange(payload) || payload.changeType !== 'BILLING_INTERVAL_CHANGE' ||
            payload.subscriptionId !== subscription.subscriptionId || payload.targetPlanId !== targetPlan.planId) {
          throw new Error('服务端未返回有效的计费周期变更确认。');
        }
        setMessage(payload.status === 'APPLIED'
          ? '服务端已确认计费周期变更完成。'
          : '计费周期变更已排期，将于 ' + formatDate(payload.effectiveAt) + ' 生效；本周期不会提前改变。');
        return;
      }

      setError('当前方案组合暂不支持在线切换。请刷新套餐目录或保持现有订阅。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '套餐变更失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }, [availablePlans, busy, getIdempotencyKey, loadSubscription, preview, readFailure, selectedPlanId, subscription]);

  const selectedPlan = availablePlans.find((plan) => plan.planId === selectedPlanId) ?? null;
  const canSubmit = Boolean(preview && selectedPlan && !busy && !loadingPreview &&
    ((preview.changeType === 'UPGRADE' && preview.paymentRequired) ||
      (preview.changeType === 'DOWNGRADE' && !preview.paymentRequired) ||
      (preview.changeType === 'BILLING_INTERVAL_CHANGE' && !preview.paymentRequired)));

  if (authStatus === 'loading' || loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text className="mt-3 text-sm text-neutral-500">正在读取订阅和可用套餐…</Text>
      </View>
    );
  }

  if (authRequired || authStatus !== 'authenticated') {
    return (
      <View className="flex-1 items-center justify-center bg-white px-7 dark:bg-black">
        <StatusBar barStyle="dark-content" />
        <Feather name="lock" size={34} color={PRIMARY} />
        <Text className="mt-4 text-lg font-extrabold text-neutral-900 dark:text-white">登录后管理订阅</Text>
        <Pressable onPress={() => router.replace(('/login?returnTo=' + encodeURIComponent('/subscriptions')) as never)} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
          <Text className="font-bold text-white">登录</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-black">
        <View className="flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} className="mr-3 rounded-full p-1">
            <Feather name="arrow-left" size={23} color="#667085" />
          </Pressable>
          <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">管理订阅套餐</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="刷新订阅和套餐" onPress={() => void refresh()} disabled={busy} className="rounded-full p-2">
          <Feather name="refresh-cw" size={19} color={PRIMARY} />
        </Pressable>
      </View>

      {error ? (
        <View className="mx-4 mt-3 flex-row items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 dark:border-rose-900 dark:bg-rose-950/30">
          <Text accessibilityRole="alert" className="flex-1 text-sm leading-5 text-rose-700 dark:text-rose-300">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void refresh()}>
            <Text className="font-bold text-sky-600">刷新</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 36 }}
      >
        {subscription ? (
          <View className="mx-4 mb-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500">当前订阅</Text>
            <Text className="mt-2 text-base font-extrabold text-neutral-900 dark:text-white">{subscription.planId}</Text>
            <Text className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">状态：{subscription.status}</Text>
            <Text className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              当前周期：{formatDate(subscription.currentPeriodStart)} 至 {formatDate(subscription.currentPeriodEnd)}
            </Text>
            <Text className="mt-3 text-xs leading-5 text-neutral-500">
              套餐变更由 W07 根据当前订阅版本报价。升级需补差价并通过原生 Hyperswitch 付款；降级和计费周期切换在当前周期结束时生效。
            </Text>
          </View>
        ) : null}

        <View className="mx-4 mb-3">
          <Text className="text-base font-extrabold text-neutral-900 dark:text-white">可切换的创作者套餐</Text>
          <Text className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            仅列出同一创作者的有效付费套餐。最终价格、税费和应付金额由服务端确定，不使用客户端报价扣款。
          </Text>
        </View>

        {availablePlans.length === 0 ? (
          <View className="mx-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <Text className="text-sm leading-6 text-neutral-500 dark:text-neutral-400">
              当前没有可切换的同创作者付费套餐。免费方案、跨创作者迁移和同价套餐直接替换暂不开放。
            </Text>
          </View>
        ) : availablePlans.map((plan) => {
          const selected = selectedPlanId === plan.planId;
          return (
            <Pressable
              key={plan.planId}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              onPress={() => void selectPlan(plan)}
              className={'mx-4 mb-3 rounded-2xl border bg-white p-4 dark:bg-neutral-950 ' +
                (selected ? 'border-sky-500' : 'border-neutral-200 dark:border-neutral-800')}
            >
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-extrabold text-neutral-900 dark:text-white">{plan.name}</Text>
                  <Text className="mt-1 text-xs text-neutral-500">{plan.tier} · {planInterval(plan.billingInterval)}</Text>
                </View>
                <Text className="font-bold text-neutral-900 dark:text-white">{formatPrice(plan.priceMinor, plan.currency)}</Text>
              </View>
              {plan.benefits.length > 0 ? (
                <Text className="mt-2 text-xs leading-5 text-neutral-500">{plan.benefits.join(' · ')}</Text>
              ) : null}
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-sky-600">{selected ? '已选择' : '查看变更报价'}</Text>
                <Feather name={selected ? 'check-circle' : 'chevron-right'} size={17} color={PRIMARY} />
              </View>
            </Pressable>
          );
        })}

        {hasMorePlans && nextCursor ? (
          <Pressable
            accessibilityRole="button"
            disabled={loadingPlans || busy}
            onPress={() => {
              setLoadingPlans(true);
              void loadPlans(nextCursor, true).catch((cause) => {
                setError(cause instanceof Error ? cause.message : '更多套餐读取失败。');
              }).finally(() => setLoadingPlans(false));
            }}
            className="mx-4 mb-4 items-center rounded-full border border-neutral-300 py-3 dark:border-neutral-700"
          >
            {loadingPlans ? <ActivityIndicator color={PRIMARY} /> : <Text className="font-bold text-sky-600">加载更多套餐</Text>}
          </Pressable>
        ) : null}

        {loadingPreview ? (
          <View className="mx-4 my-4 items-center rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
            <ActivityIndicator color={PRIMARY} />
            <Text className="mt-2 text-sm text-neutral-500">正在向 W07 获取套餐变更报价…</Text>
          </View>
        ) : null}

        {preview && selectedPlan ? (
          <View className="mx-4 mt-2 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <Text className="text-base font-extrabold text-neutral-900 dark:text-white">变更报价</Text>
            <View className="mt-3 flex-row justify-between">
              <Text className="text-sm text-neutral-500">变更类型</Text>
              <Text className="text-sm font-bold text-neutral-900 dark:text-white">
                {preview.changeType === 'UPGRADE' ? '立即升级' :
                  preview.changeType === 'DOWNGRADE' ? '周期末降级' :
                    preview.changeType === 'BILLING_INTERVAL_CHANGE' ? '周期切换' :
                      preview.changeType === 'NO_CHANGE' ? '无需变更' : '暂不支持'}
              </Text>
            </View>
            <View className="mt-2 flex-row justify-between">
              <Text className="text-sm text-neutral-500">当前套餐</Text>
              <Text className="ml-4 flex-1 text-right text-sm font-semibold text-neutral-900 dark:text-white">{preview.currentPlan.name}</Text>
            </View>
            <View className="mt-2 flex-row justify-between">
              <Text className="text-sm text-neutral-500">目标套餐</Text>
              <Text className="ml-4 flex-1 text-right text-sm font-semibold text-neutral-900 dark:text-white">{preview.targetPlan.name}</Text>
            </View>
            <View className="mt-2 flex-row justify-between">
              <Text className="text-sm text-neutral-500">目标价格</Text>
              <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
                {formatPrice(preview.targetPlan.priceMinor, preview.targetPlan.currency)} / {planInterval(preview.targetPlan.billingInterval)}
              </Text>
            </View>
            <View className="mt-2 flex-row justify-between">
              <Text className="text-sm text-neutral-500">预计生效</Text>
              <Text className="ml-4 flex-1 text-right text-sm font-semibold text-neutral-900 dark:text-white">
                {preview.changeType === 'UPGRADE' ? '付款成功并经服务端验签履约后' : formatDate(preview.effectiveAt)}
              </Text>
            </View>
            {preview.changeType === 'UPGRADE' ? (
              <View className="mt-3 rounded-xl bg-sky-50 p-3 dark:bg-sky-950/30">
                <Text className="text-sm font-bold text-sky-800 dark:text-sky-200">
                  初步补差价：{formatPrice(preview.prorationBaseMinor, preview.currency)}
                </Text>
                <Text className="mt-1 text-xs leading-5 text-sky-700 dark:text-sky-300">
                  这是税费和折扣前的列表价差额估算，并非最终扣款金额。最终订单金额和税费由 W07 服务端计算并在付款前展示。
                </Text>
              </View>
            ) : preview.changeType === 'DOWNGRADE' || preview.changeType === 'BILLING_INTERVAL_CHANGE' ? (
              <Text className="mt-3 text-xs leading-5 text-neutral-500">
                本次不会立即改变当前权益，也不会现在创建扣款。目标套餐将在当前计费周期结束时生效。
              </Text>
            ) : (
              <Text className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
                当前套餐组合没有受支持的安全变更路径，不会提交任何修改。
              </Text>
            )}
            {canSubmit ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void executeChange()}
                className="mt-5 min-h-12 items-center justify-center rounded-full bg-sky-500 px-5 py-3 disabled:opacity-50"
              >
                {busy ? <ActivityIndicator color="#ffffff" /> : (
                  <Text className="font-bold text-white">
                    {preview.changeType === 'UPGRADE' ? '确认升级并付款' :
                      preview.changeType === 'DOWNGRADE' ? '确认周期末降级' : '确认切换计费周期'}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {message ? (
          <View className="mx-4 mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
            <Text accessibilityRole="status" className="text-sm leading-6 text-sky-800 dark:text-sky-200">{message}</Text>
          </View>
        ) : null}

        <View className="mx-4 mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <Text className="text-sm font-bold text-neutral-900 dark:text-white">管理权限说明</Text>
          <Text className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            本页面只开放已接通 W07 的套餐升级、周期末降级和计费周期切换。取消、暂停、恢复操作仍由服务端验证与支付渠道生命周期同步门禁保护，APP 不会显示无法完成的操作，也不会仅凭客户端状态改变订阅权益。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
