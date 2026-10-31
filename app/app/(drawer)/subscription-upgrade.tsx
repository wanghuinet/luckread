import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

import { createIdempotencyKey, getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import {
  createSubscriptionPlanUpgradeCheckout,
  fetchActiveMembershipPlansPage,
  fetchMySubscriptionsPage,
  fetchSubscriptionPlanChangeQuote,
  scheduleSubscriptionPlanChangeAtPeriodEnd,
  type ActiveMembershipPlan,
  type MySubscription,
  type MySubscriptionPage,
  type SubscriptionPlanChangeQuote,
  type SubscriptionPlanUpgradeCheckout,
} from '~/lib/subscriptions-api';
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';
const PAGE_SIZE = 50;

function upgradeStorageKey(subscription: MySubscription): string {
  return 'lr.upgrade.' + subscription.subscriptionId + '.v' + String(subscription.version);
}

type StoredUpgradeCheckout = {
  targetPlanId: string;
  idempotencyKey: string;
  orderId?: string;
};

function parseStoredUpgradeCheckout(value: string | null): StoredUpgradeCheckout | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) ||
        typeof parsed.targetPlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(parsed.targetPlanId) ||
        typeof parsed.idempotencyKey !== 'string' || parsed.idempotencyKey.length < 1 ||
        parsed.idempotencyKey.length > 256 ||
        (parsed.orderId !== undefined && (typeof parsed.orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(parsed.orderId)))) {
      return null;
    }
    return parsed as StoredUpgradeCheckout;
  } catch {
    return null;
  }
}

function money(amountMinor: number, currency: string): string {
  try {
    const fractionDigits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
    }).format(amountMinor / (10 ** fractionDigits));
  } catch {
    return currency + ' ' + String(amountMinor);
  }
}

function dateLabel(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('zh-CN') : '—';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSubscriptionPage(value: unknown): value is MySubscriptionPage {
  if (!isRecord(value) || !Array.isArray(value.docs)) return false;
  return typeof value.page === 'number' &&
    typeof value.hasNextPage === 'boolean' &&
    value.docs.every((item) => isRecord(item) &&
      typeof item.subscriptionId === 'string' &&
      typeof item.planId === 'string' &&
      typeof item.status === 'string' &&
      typeof item.etag === 'string');
}

function isPlanPage(value: unknown): value is { docs: ActiveMembershipPlan[]; hasMore: boolean; nextCursor: string | null } {
  if (!isRecord(value) || !Array.isArray(value.docs)) return false;
  return typeof value.hasMore === 'boolean' &&
    (value.nextCursor === null || typeof value.nextCursor === 'string') &&
    value.docs.every((item) => isRecord(item) &&
      typeof item.planId === 'string' &&
      typeof item.creatorId === 'string' &&
      typeof item.planVersion === 'number' &&
      typeof item.priceMinor === 'number' &&
      typeof item.currency === 'string' &&
      (item.billingInterval === 'MONTHLY' || item.billingInterval === 'YEARLY'));
}

export default function SubscriptionUpgradeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ subscriptionId?: string }>();
  const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : '';
  const authStatus = useAuthStore((state) => state.status);
  const currentSubscriptionRef = useRef<MySubscription | null>(null);

  const [subscription, setSubscription] = useState<MySubscription | null>(null);
  const [plans, setPlans] = useState<ActiveMembershipPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [quote, setQuote] = useState<SubscriptionPlanChangeQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderCreated, setOrderCreated] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [checkoutKey, setCheckoutKey] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const login = useCallback(() => {
    router.replace(('/login?returnTo=' + encodeURIComponent('/subscription-upgrade?subscriptionId=' + subscriptionId)) as never);
  }, [router, subscriptionId]);

  const loadData = useCallback(async (signal?: AbortSignal): Promise<MySubscription | null> => {
    if (!subscriptionId) throw new Error('订阅编号无效。');

    let found: MySubscription | null = null;
    let page = 1;
    for (; page <= 20; page += 1) {
      const result = await fetchMySubscriptionsPage({ page, limit: PAGE_SIZE, signal });
      if (signal?.aborted) return null;
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(result.data, '无法读取订阅记录。', result.response.status));
      }
      const payload = unwrapApiData<unknown>(result.data);
      if (!isSubscriptionPage(payload)) throw new Error('订阅服务返回的数据格式无效。');
      found = payload.docs.find((item) => item.subscriptionId === subscriptionId) ?? null;
      if (found || !payload.hasNextPage) break;
    }
    if (!found) throw new Error('没有找到这条订阅记录，或该订阅不属于当前账户。');
    if (found.status !== 'ACTIVE' || found.cancelAt !== null) {
      throw new Error('当前仅支持有效且未安排取消的订阅升级。');
    }
    if (!found.creatorId) throw new Error('无法确认订阅所属创作者，已安全停止套餐变更。');

    const loadedPlans: ActiveMembershipPlan[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const result = await fetchActiveMembershipPlansPage({ limit: PAGE_SIZE, cursor, signal });
      if (signal?.aborted) return null;
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(result.data, '无法读取可用会员方案。', result.response.status));
      }
      const payload = unwrapApiData<unknown>(result.data);
      if (!isPlanPage(payload)) throw new Error('会员方案服务返回的数据格式无效。');
      loadedPlans.push(...payload.docs.filter((plan) => plan.creatorId === found!.creatorId));
      if (!payload.hasMore || !payload.nextCursor) break;
      cursor = payload.nextCursor;
    }

    const previous = currentSubscriptionRef.current;
    if (previous && (previous.subscriptionId !== found.subscriptionId || previous.version !== found.version)) {
      if (previous.subscriptionId === found.subscriptionId) {
        void SecureStore.deleteItemAsync(upgradeStorageKey(previous)).catch(() => undefined);
      }
      setSelectedPlanId('');
      setQuote(null);
      setOrderCreated(false);
      setOrderId('');
      setCheckoutKey('');
    }
    currentSubscriptionRef.current = found;
    setSubscription(found);
    setPlans(loadedPlans);

    // Restore the same server-scoped Idempotency-Key and Order ID after app
    // restart. A source-version may have only one pending upgrade order.
    let stored: StoredUpgradeCheckout | null = null;
    try {
      const raw = await SecureStore.getItemAsync(upgradeStorageKey(found));
      stored = parseStoredUpgradeCheckout(raw);
    } catch {
      stored = null;
    }
    if (stored) {
      setSelectedPlanId(stored.targetPlanId);
      setCheckoutKey(stored.idempotencyKey);
      setOrderId(stored.orderId ?? '');
      setOrderCreated(Boolean(stored.orderId));
      if (loadedPlans.some((plan) => plan.planId === stored.targetPlanId)) {
        try {
          const quoteResult = await fetchSubscriptionPlanChangeQuote({
            subscriptionId: found.subscriptionId,
            targetPlanId: stored.targetPlanId,
            etag: found.etag,
            signal,
          });
          if (signal?.aborted) return null;
          if (quoteResult.response.ok) {
            const restoredQuote = unwrapApiData<unknown>(quoteResult.data);
            if (isRecord(restoredQuote) &&
                restoredQuote.quoteStatus === 'PREVIEW_ONLY' &&
                restoredQuote.subscriptionId === found.subscriptionId &&
                isRecord(restoredQuote.targetPlan) &&
                restoredQuote.targetPlan.planId === stored.targetPlanId) {
              setQuote(restoredQuote as unknown as SubscriptionPlanChangeQuote);
            }
          } else {
            setError(quoteResult.error?.message || getApiErrorMessage(quoteResult.data, '无法恢复升级报价。', quoteResult.response.status));
          }
        } catch (cause) {
          if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '无法恢复升级报价。');
        }
      } else if (stored.orderId) {
        setMessage('目标方案已从公开目录下架，但你已有的升级订单仍保留；可以继续打开该订单查看支付状态。');
      } else {
        setError('目标方案已下架，尚未创建订单。请重新选择公开方案。');
        try { await SecureStore.deleteItemAsync(upgradeStorageKey(found)); } catch { /* best effort */ }
        setSelectedPlanId('');
        setCheckoutKey('');
      }
    }
    return found;
  }, [subscriptionId]);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadData(controller.signal).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '加载订阅升级信息失败。');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [authStatus, loadData]);

  const availablePlans = useMemo(
    () => plans.filter((item) => item.planId !== subscription?.planId),
    [plans, subscription],
  );
  const selectedPlan = useMemo(
    () => plans.find((item) => item.planId === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const choosePlan = useCallback(async (plan: ActiveMembershipPlan) => {
    if (!subscription || subscription.scheduledPlanChange || orderCreated || loadingQuote || creatingOrder) return;
    setSelectedPlanId(plan.planId);
    setQuote(null);
    setError('');
    setMessage('');
    setLoadingQuote(true);
    try {
      const result = await fetchSubscriptionPlanChangeQuote({
        subscriptionId: subscription.subscriptionId,
        targetPlanId: plan.planId,
        etag: subscription.etag,
      });
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(result.data, '无法计算套餐变更报价。', result.response.status));
      }
      const value = unwrapApiData<unknown>(result.data);
      if (!isRecord(value) || value.quoteStatus !== 'PREVIEW_ONLY' ||
          value.subscriptionId !== subscription.subscriptionId ||
          !isRecord(value.targetPlan) || value.targetPlan.planId !== plan.planId ||
          !['UPGRADE', 'DOWNGRADE', 'CROSSGRADE', 'BILLING_INTERVAL_CHANGE'].includes(String(value.direction)) ||
          typeof value.amountDueBeforeTaxMinor !== 'number' ||
          typeof value.currency !== 'string' ||
          value.paymentActionAvailable !== false ||
          value.mutationPerformed !== false ||
          value.entitlementChanged !== false) {
        throw new Error('套餐报价未通过完整性校验。');
      }
      setQuote(value as unknown as SubscriptionPlanChangeQuote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法计算套餐变更报价。');
    } finally {
      setLoadingQuote(false);
    }
  }, [subscription, orderCreated, loadingQuote, creatingOrder]);

  const resumeExistingOrder = useCallback(async () => {
    if (!orderId || creatingOrder) return;
    setCreatingOrder(true);
    setError('');
    try {
      await WebBrowser.openBrowserAsync('https://luckread.com/checkout?orderId=' + encodeURIComponent(orderId));
      const refreshed = await loadData();
      if (refreshed && subscription && refreshed.planId !== subscription.planId) {
        setMessage('服务端已确认订阅发生变化。');
      } else {
        setMessage('已返回 APP。支付及权益状态以 W07 服务端确认结果为准。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法重新打开升级订单。');
    } finally {
      setCreatingOrder(false);
    }
  }, [orderId, creatingOrder, loadData, subscription]);

  const startSchedulePlanChange = useCallback(async () => {
    if (!subscription || !selectedPlan || !quote ||
        !['DOWNGRADE', 'BILLING_INTERVAL_CHANGE'].includes(quote.direction) ||
        quote.paymentRequired || creatingOrder || subscription.scheduledPlanChange) return;
    setCreatingOrder(true);
    setError('');
    setMessage('');
    try {
      const storageKey = 'lr.plan-schedule.' + subscription.subscriptionId + '.v' + String(subscription.version);
      let stored: { targetPlanId: string; idempotencyKey: string } | null = null;
      try {
        const raw: unknown = JSON.parse((await SecureStore.getItemAsync(storageKey)) ?? 'null');
        if (isRecord(raw) && typeof raw.targetPlanId === 'string' &&
            /^plan_[a-f0-9]{64}$/.test(raw.targetPlanId) &&
            typeof raw.idempotencyKey === 'string' && raw.idempotencyKey.length > 0 &&
            raw.idempotencyKey.length <= 256) {
          stored = { targetPlanId: raw.targetPlanId, idempotencyKey: raw.idempotencyKey };
        }
      } catch {
        stored = null;
      }
      if (stored && stored.targetPlanId !== selectedPlan.planId) {
        throw new Error('此订阅版本已有另一项套餐变更预约请求，请先处理原请求。');
      }
      const key = stored?.idempotencyKey ?? createIdempotencyKey();
      if (!stored) {
        try {
          await SecureStore.setItemAsync(storageKey, JSON.stringify({
            targetPlanId: selectedPlan.planId,
            idempotencyKey: key,
          }));
        } catch {
          throw new Error('无法安全保存套餐变更预约凭证，请检查设备安全存储后重试。');
        }
      }
      const result = await scheduleSubscriptionPlanChangeAtPeriodEnd({
        subscriptionId: subscription.subscriptionId,
        targetPlanId: selectedPlan.planId,
        etag: subscription.etag,
        idempotencyKey: key,
      });
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(result.data, '无法预约套餐变更。', result.response.status));
      }
      const scheduled = unwrapApiData<unknown>(result.data);
      if (!isRecord(scheduled) || scheduled.status !== 'SCHEDULED' ||
          typeof scheduled.changeRequestId !== 'string' || !/^sps_[a-f0-9]{60}$/.test(scheduled.changeRequestId) ||
          scheduled.subscriptionId !== subscription.subscriptionId ||
          scheduled.changeKind !== (quote.direction === 'BILLING_INTERVAL_CHANGE' ? 'BILLING_INTERVAL_CHANGE' : 'DOWNGRADE') ||
          !Number.isSafeInteger(scheduled.sourceSubscriptionVersion) ||
          scheduled.sourceSubscriptionVersion !== subscription.version ||
          !Number.isSafeInteger(scheduled.scheduledSubscriptionVersion) ||
          scheduled.scheduledSubscriptionVersion !== subscription.version + 1 ||
          !isRecord(scheduled.sourcePlan) ||
          scheduled.sourcePlan.planId !== subscription.planId ||
          !Number.isSafeInteger(scheduled.sourcePlan.planVersion) ||
          !isRecord(scheduled.targetPlan) ||
          scheduled.targetPlan.planId !== selectedPlan.planId ||
          !Number.isSafeInteger(scheduled.targetPlan.planVersion) ||
          scheduled.effectiveAt !== quote.effectiveAt ||
          scheduled.currentPeriodEnd !== quote.effectiveAt ||
          scheduled.entitlementChanged !== false ||
          typeof scheduled.replayed !== 'boolean' ||
          scheduled.mutationPerformed !== !scheduled.replayed) {
        throw new Error('套餐变更预约结果未通过完整性校验。');
      }
      setMessage(quote.direction === 'BILLING_INTERVAL_CHANGE'
        ? '已预约于 ' + dateLabel(String(scheduled.effectiveAt)) + ' 切换为' +
          (quote.targetPlan.billingInterval === 'YEARLY' ? '年付' : '月付') +
          '。当前已付期限及权益不变；下一周期将按目标方案金额续费，只有付款成功后才切换。'
        : '已预约于 ' + dateLabel(String(scheduled.effectiveAt)) + ' 降级。本周期仍保留当前套餐权益；只有下一周期续费成功后才切换。');
      setQuote(null);
      const refreshed = await loadData();
      if (refreshed?.scheduledPlanChange?.changeRequestId !== scheduled.changeRequestId) {
        setMessage('套餐变更预约已由 W07 保存并审计；刷新订阅记录后即可查看最终状态。当前套餐权益未改变。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法预约套餐降级。');
    } finally {
      setCreatingOrder(false);
    }
  }, [subscription, selectedPlan, quote, creatingOrder, loadData]);

  const startUpgradeCheckout = useCallback(async () => {
    if (orderId) {
      await resumeExistingOrder();
      return;
    }
    if (!subscription || !selectedPlan || !quote || quote.direction !== 'UPGRADE' ||
        !quote.paymentRequired || creatingOrder) return;
    setCreatingOrder(true);
    setError('');
    setMessage('');
    try {
      let currentOrderId = orderId;
      const storageKey = upgradeStorageKey(subscription);
      let stored: StoredUpgradeCheckout | null = null;
      try {
        stored = parseStoredUpgradeCheckout(await SecureStore.getItemAsync(storageKey));
      } catch {
        stored = null;
      }
      if (stored && stored.targetPlanId !== selectedPlan.planId) {
        throw new Error('此订阅版本已有另一方案的升级请求，请先完成或放弃该订单后再选择其他方案。');
      }
      const key = checkoutKey || stored?.idempotencyKey || createIdempotencyKey();
      if (!currentOrderId && !checkoutKey && !stored?.idempotencyKey) {
        setCheckoutKey(key);
        try {
          await SecureStore.setItemAsync(storageKey, JSON.stringify({
            targetPlanId: selectedPlan.planId,
            idempotencyKey: key,
          } satisfies StoredUpgradeCheckout));
        } catch {
          throw new Error('无法安全保存升级重试凭证，请检查设备安全存储后重试。');
        }
      }
      if (!currentOrderId) {
        const result = await createSubscriptionPlanUpgradeCheckout({
          subscriptionId: subscription.subscriptionId,
          targetPlanId: selectedPlan.planId,
          etag: subscription.etag,
          idempotencyKey: key,
        });
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(result.data, '无法创建升级订单。', result.response.status));
      }
      const checkout = unwrapApiData<unknown>(result.data);
      if (!isRecord(checkout) || checkout.status !== 'PAYMENT_REQUIRED' ||
          checkout.paymentRequired !== true || typeof checkout.changeRequestId !== 'string' ||
          !isRecord(checkout.order) ||
          typeof checkout.order.orderId !== 'string' ||
          !/^ord_[A-Za-z0-9_-]{1,90}$/.test(checkout.order.orderId) ||
          checkout.paymentIntentPath !== '/api/v1/payments/intents') {
        throw new Error('升级订单未通过完整性校验。');
      }

      const order = checkout.order as { orderId: string; totalMinor?: number; currency?: string };
      if (typeof order.totalMinor !== 'number' || order.totalMinor <= 0 ||
          typeof order.currency !== 'string' || !/^[A-Z]{3}$/.test(order.currency)) {
        throw new Error('升级订单金额无效，已停止打开支付页面。');
      }
      currentOrderId = order.orderId;
      setOrderId(currentOrderId);
      setOrderCreated(true);
      try {
        await SecureStore.setItemAsync(storageKey, JSON.stringify({
          targetPlanId: selectedPlan.planId,
          idempotencyKey: key,
          orderId: currentOrderId,
        } satisfies StoredUpgradeCheckout));
      } catch {
        // The order is already persisted by W07; the current screen still holds
        // it in state and can continue the same checkout during this session.
      }
      }
      const url = 'https://luckread.com/checkout?orderId=' + encodeURIComponent(currentOrderId);
      setMessage('升级订单已保留。系统浏览器若未登录 LuckRead，请先登录；关闭支付页后可继续同一笔订单。');
      await WebBrowser.openBrowserAsync(url);
      const refreshed = await loadData();
      if (refreshed?.planId === selectedPlan.planId) {
        setMessage('服务端已确认套餐升级生效。');
      } else {
        setMessage('已返回 APP。当前订阅仍以 W07 的服务端状态为准；尚未收到确认时可继续打开原订单。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法启动安全支付流程。');
    } finally {
      setCreatingOrder(false);
    }
  }, [subscription, selectedPlan, quote, creatingOrder, orderId, checkoutKey, loadData, resumeExistingOrder]);

  if (authStatus === 'loading' || loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={PRIMARY} />
        <Text className="mt-3 text-sm text-neutral-500">正在读取订阅及可用方案…</Text>
      </View>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <View className="flex-1 items-center justify-center bg-white px-7 dark:bg-black">
        <Feather name="lock" size={34} color={PRIMARY} />
        <Text className="mt-4 text-lg font-extrabold text-neutral-900 dark:text-white">登录后更改订阅</Text>
        <Text className="mt-2 text-center text-sm leading-6 text-neutral-500">订阅和升级订单属于账户数据，需要先登录。</Text>
        <Pressable onPress={login} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
          <Text className="font-bold text-white">登录</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-neutral-50 dark:bg-black">
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-black">
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} className="mr-3 rounded-full p-1">
          <Feather name="arrow-left" size={23} color="#667085" />
        </Pressable>
        <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">订阅套餐变更</Text>
      </View>

      {subscription ? (
        <View className="mx-4 mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <Text className="text-xs font-bold text-neutral-500">当前订阅</Text>
          <Text selectable className="mt-1 text-sm font-bold text-neutral-900 dark:text-white">{subscription.planId}</Text>
          <Text className="mt-2 text-xs text-neutral-500">
            当前周期：{dateLabel(subscription.currentPeriodStart)} — {dateLabel(subscription.currentPeriodEnd)}
          </Text>
          {subscription.scheduledPlanChange ? (
            <Text className="mt-2 text-xs font-semibold text-sky-700 dark:text-sky-300">
              已预约周期末{subscription.scheduledPlanChange.changeKind === 'BILLING_INTERVAL_CHANGE' ? '切换账期' : '降级'}至 {subscription.scheduledPlanChange.planId}，在续费成功前当前权益保持不变。
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="px-4 pt-5">
        <Text className="text-base font-extrabold text-neutral-900 dark:text-white">选择同一创作者的会员方案</Text>
        <Text className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          报价由 W07 使用套餐不可变版本与当前订阅周期计算。此处只预览；只有订单支付被 Hyperswitch Webhook 验证后，服务端才会切换套餐权益。
        </Text>
      </View>

      {availablePlans.length === 0 ? (
        <View className="mx-4 mt-4 rounded-xl bg-white p-4 dark:bg-neutral-950">
          <Text className="text-sm text-neutral-500">当前创作者没有其他公开会员方案。</Text>
        </View>
      ) : (
        <FlatList
          data={availablePlans}
          keyExtractor={(item) => item.planId}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          renderItem={({ item }) => {
            const selected = item.planId === selectedPlanId;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: orderCreated || loadingQuote || creatingOrder }}
                disabled={orderCreated || Boolean(checkoutKey) || loadingQuote || creatingOrder}
                onPress={() => void choosePlan(item)}
                className={
                  'mx-4 mb-3 rounded-2xl border p-4 ' +
                  (selected ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30' : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950')
                }
              >
                <View className="flex-row items-start justify-between">
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-bold text-neutral-900 dark:text-white">{item.name}</Text>
                    <Text className="mt-1 text-xs text-neutral-500">{item.tier} · {item.billingInterval === 'MONTHLY' ? '月付' : '年付'}</Text>
                  </View>
                  <Text className="text-sm font-extrabold text-neutral-900 dark:text-white">{money(item.priceMinor, item.currency)}</Text>
                </View>
                {selected ? <Text className="mt-2 text-xs font-semibold text-sky-700 dark:text-sky-300">已选择</Text> : null}
              </Pressable>
            );
          }}
        />
      )}

      {loadingQuote ? (
        <View className="mx-4 mb-4 flex-row items-center gap-3 rounded-xl bg-white p-4 dark:bg-neutral-950">
          <ActivityIndicator color={PRIMARY} />
          <Text className="text-sm text-neutral-500">正在计算服务端报价…</Text>
        </View>
      ) : null}

      {quote ? (
        <View className="mx-4 mb-4 rounded-2xl border border-sky-200 bg-white p-4 dark:border-sky-900 dark:bg-neutral-950">
          <Text className="text-sm font-extrabold text-neutral-900 dark:text-white">套餐变更报价</Text>
          <Text className="mt-2 text-xs text-neutral-500">
            {quote.direction === 'UPGRADE' ? '立即升级' :
              quote.direction === 'DOWNGRADE' ? '周期末降级预览' :
              quote.direction === 'BILLING_INTERVAL_CHANGE' ? '周期末切换月付/年付' : '周期末同价变更预览'}
          </Text>
          <Text className="mt-1 text-2xl font-extrabold text-neutral-900 dark:text-white">
            {quote.direction === 'UPGRADE' ? money(quote.amountDueBeforeTaxMinor, quote.currency) : '本期不收取套餐差价'}
          </Text>
          <Text className="mt-1 text-xs leading-5 text-neutral-500">
            {quote.direction === 'UPGRADE'
              ? '这是本周期剩余时间的税前差价估算。实际税额由结账时已配置的服务端计税方式计算。'
              : quote.direction === 'DOWNGRADE'
              ? '当前周期继续保留原套餐权益；只有周期末的下一笔续费成功后，才切换为目标套餐。'
              : quote.direction === 'BILLING_INTERVAL_CHANGE'
              ? '当前已付周期不会缩短或重新计费。到期后按目标' +
                (quote.targetPlan.billingInterval === 'YEARLY' ? '年付' : '月付') +
                '周期生成下一期续费；支付成功后才切换套餐与权益。'
              : '同价套餐调整暂不自动执行；目前仅提供预览，不会修改订阅或权益。'}
          </Text>
          <Text className="mt-2 text-xs text-neutral-500">预计生效：{dateLabel(quote.effectiveAt)}</Text>
          {quote.direction === 'BILLING_INTERVAL_CHANGE' ? (
            <Text className="mt-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              下期续费金额：{money(quote.targetPlan.priceMinor, quote.targetPlan.currency)} / {quote.targetPlan.billingInterval === 'YEARLY' ? '年' : '月'}
            </Text>
          ) : null}
          {quote.direction === 'UPGRADE' && quote.paymentRequired ? (
            orderCreated ? (
              <Text className="mt-3 text-xs font-semibold text-sky-700 dark:text-sky-300">
                升级订单已创建。请使用下方入口继续支付；只有服务端验证付款后才会变更套餐。
              </Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={creatingOrder}
                onPress={() => void startUpgradeCheckout()}
                className="mt-4 items-center rounded-full bg-sky-500 px-5 py-3"
              >
                <Text className="font-bold text-white">{creatingOrder ? '正在准备支付…' : '创建升级订单并前往安全支付'}</Text>
              </Pressable>
            )
          ) : quote.direction === 'DOWNGRADE' || quote.direction === 'BILLING_INTERVAL_CHANGE' ? (
            subscription?.scheduledPlanChange ? (
              <Text className="mt-3 text-xs font-semibold text-sky-700 dark:text-sky-300">
                已有套餐变更预约：{subscription.scheduledPlanChange.planId}，预计 {dateLabel(subscription.scheduledPlanChange.effectiveAt)} 生效。
              </Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={creatingOrder}
                onPress={() => void startSchedulePlanChange()}
                className="mt-4 items-center rounded-full bg-sky-500 px-5 py-3"
              >
                <Text className="font-bold text-white">{creatingOrder ? '正在保存预约…' :
                  quote.direction === 'BILLING_INTERVAL_CHANGE' ? '预约账期变更' : '预约在周期末降级'}</Text>
              </Pressable>
            )
          ) : (
            <Text className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
              同价套餐调整暂未开放，不会修改订阅或权益。
            </Text>
          )}
        </View>
      ) : null}

      {orderCreated && orderId ? (
        <View className="mx-4 mb-4 rounded-2xl border border-sky-200 bg-white p-4 dark:border-sky-900 dark:bg-neutral-950">
          <Text className="text-sm font-extrabold text-neutral-900 dark:text-white">已有升级订单</Text>
          <Text selectable className="mt-1 text-xs text-neutral-500">{orderId}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={creatingOrder}
            onPress={() => void resumeExistingOrder()}
            className="mt-3 items-center rounded-full bg-sky-500 px-5 py-3"
          >
            <Text className="font-bold text-white">{creatingOrder ? '正在打开…' : '继续支付这笔订单'}</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <View className="mx-4 mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
          <Text accessibilityRole="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</Text>
        </View>
      ) : null}
      {message ? (
        <Text className="mx-4 mb-5 text-xs leading-5 text-neutral-500">{message}</Text>
      ) : null}
    </View>
  );
}
