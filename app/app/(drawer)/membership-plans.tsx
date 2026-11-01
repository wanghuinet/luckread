import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import {
  createMembershipOrder,
  createMembershipPaymentIntent,
  fetchActiveMembershipPlansPage,
  type ActiveMembershipPlan,
  type ActiveMembershipPlanPage,
} from '~/lib/subscriptions-api';
import { useAuthStore } from '~/store/auth-store';
import { assertNativeHyperswitchConfigured, presentNativeMembershipPayment } from '~/lib/hyperswitch-payment';

const PRIMARY = '#1d9bf0';
const PAGE_SIZE = 20;

function isMembershipPlan(value: unknown): value is ActiveMembershipPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.planId === 'string' && /^plan_[a-f0-9]{64}$/.test(item.planId) &&
    typeof item.creatorId === 'string' && item.creatorId.length > 0 && item.creatorId.length <= 256 &&
    typeof item.planVersion === 'number' && Number.isSafeInteger(item.planVersion) && item.planVersion > 0 &&
    typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 120 &&
    typeof item.tier === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(item.tier) &&
    (item.billingInterval === 'MONTHLY' || item.billingInterval === 'YEARLY') &&
    typeof item.priceMinor === 'number' && Number.isSafeInteger(item.priceMinor) &&
    item.priceMinor >= 0 && item.priceMinor <= 2_147_483_647 &&
    typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency) &&
    Array.isArray(item.benefits) && item.benefits.length <= 20 &&
    item.benefits.every((benefit) => typeof benefit === 'string' && benefit.trim() === benefit &&
      benefit.length > 0 && benefit.length <= 180) &&
    new Set(item.benefits).size === item.benefits.length &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) &&
    typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt));
}

function isMembershipPlanPage(value: unknown): value is ActiveMembershipPlanPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  return typeof page.limit === 'number' && Number.isSafeInteger(page.limit) && page.limit >= 1 && page.limit <= 50 &&
    Array.isArray(page.docs) && page.docs.length <= page.limit && page.docs.every(isMembershipPlan) &&
    typeof page.hasMore === 'boolean' &&
    (page.hasMore
      ? typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 2048
      : page.nextCursor === null);
}

function formatPrice(priceMinor: number, currency: string): string {
  if (priceMinor === 0) return '免费';
  try {
    const digits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
    }).format(priceMinor / (10 ** digits));
  } catch {
    return currency + ' ' + String(priceMinor);
  }
}

function PlanCard({ item, onPurchase, busy }: {
  item: ActiveMembershipPlan;
  onPurchase: (item: ActiveMembershipPlan) => void;
  busy: boolean;
}) {
  const interval = item.billingInterval === 'MONTHLY' ? '每月' : '每年';
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-extrabold text-neutral-900 dark:text-white">{item.name}</Text>
          <Text className="mt-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {item.tier} · 创作者会员
          </Text>
        </View>
        <View className="rounded-full bg-sky-50 px-3 py-1 dark:bg-sky-950/40">
          <Text className="text-xs font-bold text-sky-700 dark:text-sky-300">
            {item.billingInterval === 'MONTHLY' ? '月度方案' : '年度方案'}
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row items-baseline gap-2">
        <Text className="text-2xl font-extrabold text-neutral-900 dark:text-white">
          {formatPrice(item.priceMinor, item.currency)}
        </Text>
        <Text className="text-sm text-neutral-500">{interval}</Text>
      </View>

      {item.benefits.length > 0 ? (
        <View className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <Text className="mb-2 text-xs font-bold text-neutral-500">会员权益</Text>
          {item.benefits.map((benefit) => (
            <View key={benefit} className="mb-2 flex-row items-start gap-2">
              <Feather name="check" size={15} color={PRIMARY} style={{ marginTop: 2 }} />
              <Text className="flex-1 text-sm leading-5 text-neutral-700 dark:text-neutral-300">
                {benefit}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="mt-4 text-sm text-neutral-500">该方案尚未填写具体权益说明。</Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'订阅 ' + item.name}
        accessibilityState={{ disabled: busy || item.priceMinor === 0 }}
        disabled={busy || item.priceMinor === 0}
        onPress={() => onPurchase(item)}
        className={'mt-5 min-h-11 items-center justify-center rounded-full px-5 py-3 ' +
          (busy || item.priceMinor === 0 ? 'bg-neutral-300 dark:bg-neutral-800' : 'bg-sky-500')}
      >
        <Text className="font-bold text-white">
          {busy ? '正在准备支付…' : item.priceMinor === 0 ? '免费方案暂未开放' : '订阅并付款'}
        </Text>
      </Pressable>
      {item.priceMinor === 0 ? (
        <Text className="mt-2 text-xs leading-5 text-neutral-500">免费方案需使用独立试用或零金额开通流程，当前不创建付费订单。</Text>
      ) : null}
    </View>
  );
}

export default function MembershipPlansScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ creatorId?: string | string[]; returnTo?: string | string[] }>();
  const rawCreatorId = Array.isArray(params.creatorId) ? params.creatorId[0] : params.creatorId;
  const creatorId = typeof rawCreatorId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(rawCreatorId)
    ? rawCreatorId
    : undefined;
  const invalidCreatorFilter = rawCreatorId !== undefined && creatorId === undefined;
  const rawReturnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = typeof rawReturnTo === 'string' &&
    /^\/post\/[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(rawReturnTo)
    ? rawReturnTo
    : undefined;
  const routeQuery = new URLSearchParams();
  if (creatorId) routeQuery.set('creatorId', creatorId);
  if (returnTo) routeQuery.set('returnTo', returnTo);
  const routeSearch = routeQuery.toString();
  const membershipPlansPath = '/membership-plans' + (routeSearch ? '?' + routeSearch : '');
  const authStatus = useAuthStore((state) => state.status);
  const [items, setItems] = useState<ActiveMembershipPlan[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (cursor: string | null, append: boolean, pullRefresh = false) => {
    if (invalidCreatorFilter) {
      setError('创作者标识无效，无法加载对应会员方案。');
      setItems([]);
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      return;
    }
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setAuthRequired(true);
      setItems([]);
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (append) setLoadingMore(true);
    else if (pullRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const result = await fetchActiveMembershipPlansPage({
        limit: PAGE_SIZE,
        cursor,
        creatorId: creatorId ?? undefined,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.response.status === 401) {
        setAuthRequired(true);
        setItems([]);
        setHasMore(false);
        setNextCursor(null);
        return;
      }
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          '会员方案读取失败，请稍后重试。',
          result.response.status,
        ));
      }

      const payload = unwrapApiData<unknown>(result.data);
      if (!isMembershipPlanPage(payload)) {
        throw new Error('会员方案服务返回的数据格式无效，请重试。');
      }
      setItems((current) => {
        if (!append) return payload.docs;
        const known = new Set(current.map((item) => item.planId));
        return [...current, ...payload.docs.filter((item) => !known.has(item.planId))];
      });
      setHasMore(payload.hasMore);
      setNextCursor(payload.nextCursor);
      setAuthRequired(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '会员方案读取失败，请稍后重试。');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [authStatus, creatorId, invalidCreatorFilter]);

  useEffect(() => {
    if (authStatus !== 'loading') void loadPage(null, false);
    return () => requestRef.current?.abort();
  }, [authStatus, loadPage]);

  const openLogin = useCallback(() => {
    router.push(('/login?returnTo=' + encodeURIComponent(membershipPlansPath)) as never);
  }, [membershipPlansPath, router]);

  const handlePurchase = useCallback(async (item: ActiveMembershipPlan) => {
    if (authStatus !== 'authenticated') {
      openLogin();
      return;
    }
    if (item.priceMinor <= 0 || busyPlanId !== null) return;

    setBusyPlanId(item.planId);
    setPurchaseMessage('');
    try {
      // Fail before creating an order if the native provider SDK is not configured.
      assertNativeHyperswitchConfigured();

      const orderResult = await createMembershipOrder(item.planId);
      if (!orderResult.response.ok) {
        throw new Error(orderResult.error?.message || getApiErrorMessage(
          orderResult.data,
          '暂时无法创建会员订单，请稍后重试。',
          orderResult.response.status,
        ));
      }
      const order = unwrapApiData<unknown>(orderResult.data);
      if (
        !order || typeof order !== 'object' || Array.isArray(order) ||
        typeof (order as Record<string, unknown>).orderId !== 'string' ||
        !/^ord_[A-Za-z0-9_-]{1,90}$/.test((order as Record<string, unknown>).orderId as string) ||
        (order as Record<string, unknown>).status !== 'CREATED' ||
        typeof (order as Record<string, unknown>).totalMinor !== 'number' ||
        !Number.isSafeInteger((order as Record<string, unknown>).totalMinor) ||
        ((order as Record<string, unknown>).totalMinor as number) <= 0 ||
        typeof (order as Record<string, unknown>).currency !== 'string' ||
        !/^[A-Z]{3}$/.test((order as Record<string, unknown>).currency as string)
      ) {
        throw new Error('订单服务返回了无效的订单或金额信息，支付已停止。');
      }
      const orderData = order as {
        orderId: string;
        totalMinor: number;
        currency: string;
      };

      const intentResult = await createMembershipPaymentIntent(orderData.orderId);
      if (!intentResult.response.ok) {
        throw new Error(intentResult.error?.message || getApiErrorMessage(
          intentResult.data,
          '暂时无法启动安全支付，请稍后重试。',
          intentResult.response.status,
        ));
      }
      const intent = unwrapApiData<unknown>(intentResult.data);
      if (
        !intent || typeof intent !== 'object' || Array.isArray(intent) ||
        Object.keys(intent).length !== 9 ||
        typeof (intent as Record<string, unknown>).paymentId !== 'string' ||
        !/^pay_[a-f0-9]{26}$/.test((intent as Record<string, unknown>).paymentId as string) ||
        (intent as Record<string, unknown>).orderId !== orderData.orderId ||
        (intent as Record<string, unknown>).amountMinor !== orderData.totalMinor ||
        (intent as Record<string, unknown>).currency !== orderData.currency ||
        !['live', 'demo'].includes(String((intent as Record<string, unknown>).pricingMode)) ||
        !['requires_payment_method', 'requires_confirmation'].includes(String((intent as Record<string, unknown>).status)) ||
        typeof (intent as Record<string, unknown>).version !== 'number' ||
        !Number.isSafeInteger((intent as Record<string, unknown>).version) ||
        typeof (intent as Record<string, unknown>).clientSecret !== 'string' ||
        typeof (intent as Record<string, unknown>).sdkAuthorization !== 'string' ||
        ((intent as Record<string, unknown>).sdkAuthorization as string).length < 1 ||
        ((intent as Record<string, unknown>).sdkAuthorization as string).length > 4096 ||
        ((intent as Record<string, unknown>).sdkAuthorization as string).trim() !== (intent as Record<string, unknown>).sdkAuthorization ||
        /[\u0000-\u001f\u007f]/.test((intent as Record<string, unknown>).sdkAuthorization as string)
      ) {
        throw new Error('支付服务没有返回与当前订单匹配的有效支付会话，支付已停止。');
      }

      const result = await presentNativeMembershipPayment((intent as Record<string, unknown>).sdkAuthorization as string);
      if (result.status === 'completed') {
        setPurchaseMessage('支付表单已完成提交。LuckRead 正在等待服务端验证 Hyperswitch 支付 Webhook 并完成订阅开通；此状态不代表会员权益已经生效。');
        await loadPage(null, false);
      } else if (result.status === 'canceled') {
        setPurchaseMessage('你已取消本次支付，订阅尚未开通。');
      } else {
        setPurchaseMessage('支付未完成。请核对支付方式或稍后重试；订阅权益不会因客户端回调自动开通。');
      }
    } catch (cause) {
      setPurchaseMessage(cause instanceof Error ? cause.message : '无法启动会员支付，请稍后重试。');
    } finally {
      setBusyPlanId(null);
    }
  }, [authStatus, busyPlanId, loadPage, openLogin]);

  if (authStatus === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (authRequired || authStatus !== 'authenticated') {
    return (
      <View className="flex-1 items-center justify-center bg-white px-7 dark:bg-black">
        <StatusBar barStyle="dark-content" />
        <Feather name="award" size={36} color={PRIMARY} />
        <Text className="mt-4 text-lg font-extrabold text-neutral-900 dark:text-white">登录后查看会员方案</Text>
        <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
          登录后可查看创作者已发布的会员方案和权益说明。
        </Text>
        <Pressable accessibilityRole="button" onPress={openLogin} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
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
          <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">{creatorId ? '创作者会员方案' : '会员方案'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看我的订阅"
          onPress={() => router.push('/subscriptions' as never)}
          className="rounded-full px-2 py-2"
        >
          <Text className="text-sm font-bold text-sky-600">我的订阅</Text>
        </Pressable>
      </View>

      <View className="border-b border-neutral-100 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-black">
        <Text className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          {creatorId
            ? '以下仅显示该创作者在 W07 发布的有效公开会员方案。价格和权益以服务端记录为准。'
            : '以下方案来自 W07 已发布的公开会员目录，价格和权益以服务端记录为准。'}付款由 Hyperswitch 原生安全表单处理；只有服务端验签并完成订阅履约后，会员权益才会生效。
        </Text>
      </View>

      {purchaseMessage ? (
        <View className="mx-4 mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 dark:border-sky-900 dark:bg-sky-950/30">
          <Text accessibilityRole="alert" className="text-sm leading-5 text-sky-800 dark:text-sky-200">{purchaseMessage}</Text>
          {returnTo ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace(returnTo as never)}
              className="mt-3 min-h-10 items-center justify-center rounded-full bg-sky-500 px-4 py-2"
            >
              <Text className="font-bold text-white">返回内容并重新检查权益</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 dark:border-rose-900 dark:bg-rose-950/30">
          <Text accessibilityRole="alert" className="flex-1 text-sm leading-5 text-rose-700 dark:text-rose-300">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadPage(null, false)} disabled={loading}>
            <Text className="font-bold text-sky-600">重试</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.planId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPage(null, false, true)} />}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 36, flexGrow: 1 }}
        renderItem={({ item }) => (
          <PlanCard item={item} onPurchase={handlePurchase} busy={busyPlanId === item.planId || busyPlanId !== null} />
        )}
        ListEmptyComponent={(
          <View className="flex-1 items-center justify-center px-8 py-12">
            {loading ? <ActivityIndicator size="large" color={PRIMARY} /> : (
              <>
                <Feather name="award" size={34} color="#9ca3af" />
                <Text className="mt-4 text-base font-bold text-neutral-800 dark:text-neutral-100">
                  {error ? '暂时无法显示会员方案' : creatorId ? '该创作者暂无公开会员方案' : '暂无公开会员方案'}
                </Text>
                <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  {error ? '检查网络后重试。' : creatorId ? '创作者发布公开会员方案后，会显示在这里。' : '创作者发布公开会员方案后，会显示在这里。'}
                </Text>
              </>
            )}
          </View>
        )}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator className="py-5" color={PRIMARY} />
        ) : hasMore && nextCursor ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading || loadingMore}
            onPress={() => void loadPage(nextCursor, true)}
            className="items-center py-5"
          >
            <Text className="font-bold text-sky-600">加载更多方案</Text>
          </Pressable>
        ) : <View className="h-5" />}
      />
    </View>
  );
}
