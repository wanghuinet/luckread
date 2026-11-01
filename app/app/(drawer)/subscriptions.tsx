import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import {
  fetchMySubscriptionsPage,
  fetchSavedPaymentMethods,
  revokeSavedPaymentMethod,
  type SavedPaymentMethod,
  type MySubscription,
  type MySubscriptionPage,
  type SubscriptionStatus,
} from '~/lib/subscriptions-api';
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  PENDING: '待处理',
  TRIALING: '试用中',
  ACTIVE: '有效',
  PAST_DUE: '付款逾期',
  PAUSED: '已暂停',
  CANCELED: '已取消',
  EXPIRED: '已到期',
};

const statusClasses: Record<SubscriptionStatus, string> = {
  PENDING: 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
  TRIALING: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  PAST_DUE: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  PAUSED: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  CANCELED: 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400',
  EXPIRED: 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400',
};

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('zh-CN') : '—';
};

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS_LABELS, value);
}

function isSubscriptionRecord(value: unknown): value is MySubscription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.subscriptionId === 'string' && item.subscriptionId.length > 0 &&
    typeof item.subscriberId === 'string' &&
    typeof item.planId === 'string' && item.planId.length > 0 &&
    isSubscriptionStatus(item.status) &&
    typeof item.currentPeriodStart === 'string' &&
    typeof item.currentPeriodEnd === 'string' &&
    typeof item.etag === 'string' && item.etag.length > 0;
}

function SubscriptionCard({ item, onManage }: { item: MySubscription; onManage: () => void }) {
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500">订阅方案 ID</Text>
          <Text selectable className="mt-1 text-base font-extrabold text-neutral-900 dark:text-white">
            {item.planId}
          </Text>
          {item.creatorId ? (
            <Text selectable className="mt-1 text-xs text-neutral-500">创作者 ID：{item.creatorId}</Text>
          ) : null}
        </View>
        <View className={'rounded-full border px-3 py-1 ' + statusClasses[item.status]}>
          <Text className="text-xs font-bold">{STATUS_LABELS[item.status]}</Text>
        </View>
      </View>

      <View className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <View className="flex-row items-start gap-3">
          <Feather name="calendar" size={16} color="#667085" />
          <View className="flex-1">
            <Text className="text-xs text-neutral-500">当前订阅周期</Text>
            <Text className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              {formatDate(item.currentPeriodStart)} — {formatDate(item.currentPeriodEnd)}
            </Text>
          </View>
        </View>
        <View className="mt-3 flex-row items-start gap-3">
          <Feather name="clock" size={16} color="#667085" />
          <View className="flex-1">
            <Text className="text-xs text-neutral-500">订阅创建时间</Text>
            <Text className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
              {formatDate(item.startedAt)}
            </Text>
          </View>
        </View>
        {item.cancelAt ? (
          <View className="mt-3 flex-row items-start gap-3">
            <Feather name="calendar" size={16} color="#667085" />
            <View className="flex-1">
              <Text className="text-xs text-neutral-500">取消时间</Text>
              <Text className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
                {formatDate(item.cancelAt)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <Text selectable className="mt-3 text-[11px] leading-4 text-neutral-400">
        订阅 ID：{item.subscriptionId}
      </Text>
      {item.status === 'ACTIVE' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="管理订阅套餐"
          onPress={onManage}
          className="mt-4 min-h-10 items-center justify-center rounded-full border border-sky-500 px-4 py-2"
        >
          <Text className="text-sm font-bold text-sky-600 dark:text-sky-400">管理套餐</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MySubscriptionsScreen() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const [items, setItems] = useState<MySubscription[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<SavedPaymentMethod[]>([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true);
  const [revokingPaymentMethodId, setRevokingPaymentMethodId] = useState<string | null>(null);
  const paymentMethodRequestRef = useRef<AbortController | null>(null);
  const paymentMethodIdempotencyKeys = useRef(new Map<string, string>());

  const requestRef = useRef<AbortController | null>(null);

  const openLogin = useCallback(() => {
    router.push(('/login?returnTo=' + encodeURIComponent('/subscriptions')) as never);
  }, [router]);

  const loadPage = useCallback(async (page: number, append: boolean, pullRefresh = false) => {
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
    else setLoading(true);
    if (pullRefresh) setRefreshing(true);
    setError('');

    try {
      const result = await fetchMySubscriptionsPage({ page, limit: 20, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.response.status === 401) {
        setAuthRequired(true);
        setItems([]);
        setHasNextPage(false);
        return;
      }
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          '订阅读取失败，请稍后重试。',
          result.response.status,
        ));
      }
      const payload = unwrapApiData<MySubscriptionPage>(result.data);
      if (!payload || !Array.isArray(payload.docs) || typeof payload.hasNextPage !== 'boolean') {
        throw new Error('订阅服务返回的数据格式无效，请重试。');
      }
      if (!payload.docs.every(isSubscriptionRecord)) {
        throw new Error('订阅服务返回了无效的订阅记录，请重试。');
      }

      setItems((current) => {
        if (!append) return payload.docs;
        const known = new Set(current.map((item) => item.subscriptionId));
        return [...current, ...payload.docs.filter((item) => !known.has(item.subscriptionId))];
      });
      setPageNumber(Number.isSafeInteger(payload.page) && payload.page > 0 ? payload.page : page);
      setHasNextPage(payload.hasNextPage);
      setAuthRequired(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '订阅读取失败，请稍后重试。');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [authStatus]);

  const loadPaymentMethods = useCallback(async () => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setPaymentMethods([]);
      setPaymentMethodsLoading(false);
      return;
    }
    paymentMethodRequestRef.current?.abort();
    const controller = new AbortController();
    paymentMethodRequestRef.current = controller;
    setPaymentMethodsLoading(true);
    try {
      const result = await fetchSavedPaymentMethods({ signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.response.status === 401) {
        setAuthRequired(true);
        setPaymentMethods([]);
        return;
      }
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          '付款方式读取失败，请稍后重试。',
          result.response.status,
        ));
      }
      const payload = unwrapApiData<{ docs: SavedPaymentMethod[] }>(result.data);
      if (!payload || !Array.isArray(payload.docs) || !payload.docs.every((item) =>
        item && typeof item.savedPaymentMethodId === 'string' &&
        /^spm_[A-Za-z0-9]{26}$/.test(item.savedPaymentMethodId) &&
        typeof item.paymentMethod === 'string' &&
        typeof item.status === 'string' &&
        ['ACTIVE', 'SETUP_PENDING', 'NO_RECURRING', 'REVOCATION_PENDING'].includes(item.status)
      )) {
        throw new Error('付款方式服务返回的数据格式无效。');
      }
      setPaymentMethods(payload.docs);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '付款方式读取失败，请稍后重试。');
      }
    } finally {
      if (paymentMethodRequestRef.current === controller) paymentMethodRequestRef.current = null;
      if (!controller.signal.aborted) setPaymentMethodsLoading(false);
    }
  }, [authStatus]);

  const confirmRevokePaymentMethod = useCallback((method: SavedPaymentMethod) => {
    const label = method.brand
      ? method.brand + (method.last4 ? ' •••• ' + method.last4 : '')
      : '该付款方式';
    Alert.alert(
      '移除付款方式？',
      '移除后会立即阻止新的自动续费扣款，并请求支付渠道撤销授权。已完成的付款不会退款；若支付渠道确认仍在处理中，页面会显示“撤销处理中”。\n\n' + label,
      [
        { text: '暂不移除', style: 'cancel' },
        {
          text: '确认移除',
          style: 'destructive',
          onPress: () => {
            setRevokingPaymentMethodId(method.savedPaymentMethodId);
            setError('');
            void (async () => {
              try {
                const idempotencyKey = paymentMethodIdempotencyKeys.current.get(method.savedPaymentMethodId) ??
                  'remove_' + method.savedPaymentMethodId;
                paymentMethodIdempotencyKeys.current.set(method.savedPaymentMethodId, idempotencyKey);
                let result = await revokeSavedPaymentMethod(method.savedPaymentMethodId, idempotencyKey);
                // The first response confirms the D1-04 MIT block. Replay the
                // same idempotent command once to perform provider-side revocation
                // in a separate request/write-budget window.
                const firstStage = result.response.status === 202
                  ? unwrapApiData<{ replayed?: boolean }>(result.data)
                  : null;
                if (result.response.status === 202 && firstStage?.replayed === false) {
                  result = await revokeSavedPaymentMethod(method.savedPaymentMethodId, idempotencyKey);
                }
                if (!result.response.ok) {
                  throw new Error(result.error?.message || getApiErrorMessage(
                    result.data,
                    '付款方式移除失败，请稍后重试。',
                    result.response.status,
                  ));
                }
                await loadPaymentMethods();
                if (result.response.status === 202) {
                  Alert.alert('撤销处理中', '新的自动续费扣款已暂缓。收到 Hyperswitch 的签名确认事件后，请返回此页点击“重试移除”，完成支付渠道中的付款方式删除。');
                } else {
                  paymentMethodIdempotencyKeys.current.delete(method.savedPaymentMethodId);
                  Alert.alert('已移除', '付款方式已从支付渠道确认移除。');
                }
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '付款方式移除失败，请稍后重试。');
                // The first request may already have committed the MIT block
                // even when the provider replay failed; refresh authoritative state.
                void loadPaymentMethods();
              } finally {
                setRevokingPaymentMethodId(null);
              }
            })();
          },
        },
      ],
    );
  }, [loadPaymentMethods]);

  useEffect(() => {
    if (authStatus !== 'loading') {
      void loadPage(1, false);
      void loadPaymentMethods();
    }
    return () => {
      requestRef.current?.abort();
      paymentMethodRequestRef.current?.abort();
    };
  }, [authStatus, loadPage, loadPaymentMethods]);

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
        <Feather name="credit-card" size={36} color={PRIMARY} />
        <Text className="mt-4 text-lg font-extrabold text-neutral-900 dark:text-white">登录后管理订阅</Text>
        <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
          这里会显示订阅服务返回的真实记录，不会展示示例订阅或虚构的付款状态。
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
          <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">我的订阅</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新订阅"
          accessibilityState={{ disabled: loading || loadingMore }}
          disabled={loading || loadingMore}
          onPress={() => void loadPage(1, false)}
          className="rounded-full p-2"
        >
          <Feather name="refresh-cw" size={19} color={PRIMARY} />
        </Pressable>
      </View>

      <View className="border-b border-neutral-100 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-black">
        <Text className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          订阅状态由 W07 提供。可管理有效订阅的套餐：升级需通过原生 Hyperswitch 付款并等待签名 Webhook 履约；降级和月/年周期切换在当前周期结束时生效。取消、暂停和恢复暂不开放，付款与内容权益仍以服务端确认为准。
        </Text>
      </View>

      {error ? (
        <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 dark:border-rose-900 dark:bg-rose-950/30">
          <Text accessibilityRole="alert" className="flex-1 text-sm leading-5 text-rose-700 dark:text-rose-300">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadPage(1, false)} disabled={loading}>
            <Text className="font-bold text-sky-600">重试</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.subscriptionId}
        refreshControl={<RefreshControl refreshing={refreshing || paymentMethodsLoading} onRefresh={() => {
          void loadPage(1, false, true);
          void loadPaymentMethods();
        }} />}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 36, flexGrow: 1 }}
        ListHeaderComponent={(
          <View className="mx-4 mb-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-extrabold text-neutral-900 dark:text-white">已保存的付款方式</Text>
              <Pressable accessibilityRole="button" onPress={() => void loadPaymentMethods()} disabled={paymentMethodsLoading}>
                <Text className="text-xs font-bold text-sky-600">刷新</Text>
              </Pressable>
            </View>
            <Text className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              仅显示已完成付款并经服务器验证保存的付款方式。移除会暂缓新的自动续费扣款，不会自动退款。
            </Text>
            {paymentMethodsLoading ? (
              <ActivityIndicator className="mt-4" color={PRIMARY} />
            ) : paymentMethods.length === 0 ? (
              <Text className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">暂无已保存的付款方式</Text>
            ) : paymentMethods.map((method) => (
              <View key={method.savedPaymentMethodId} className="mt-3 flex-row items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <View className="min-w-0 flex-1 pr-3">
                  <Text className="text-sm font-bold text-neutral-900 dark:text-white">
                    {method.brand || method.paymentMethod}
                    {method.last4 ? ' •••• ' + method.last4 : ''}
                  </Text>
                  <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {method.status === 'REVOCATION_PENDING'
                      ? '撤销处理中 · 自动扣款已暂缓'
                      : method.status === 'ACTIVE'
                        ? '自动续费授权有效'
                        : method.status === 'SETUP_PENDING'
                          ? '授权确认中'
                          : '无有效自动续费授权'}
                    {method.expiryMonth && method.expiryYear ? ' · 到期 ' + method.expiryMonth + '/' + method.expiryYear : ''}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={revokingPaymentMethodId !== null}
                  onPress={() => confirmRevokePaymentMethod(method)}
                  className="rounded-full border border-rose-300 px-3 py-2 disabled:opacity-50 dark:border-rose-800"
                >
                  {revokingPaymentMethodId === method.savedPaymentMethodId
                    ? <ActivityIndicator size="small" color={PRIMARY} />
                    : <Text className="text-xs font-bold text-rose-700 dark:text-rose-300">
                        {method.status === 'REVOCATION_PENDING' ? '重试移除' : '移除'}
                      </Text>}
                </Pressable>
              </View>
            ))}
          </View>
        )}
        renderItem={({ item }) => <SubscriptionCard item={item} onManage={() => router.push(('/subscription-change?subscriptionId=' + encodeURIComponent(item.subscriptionId)) as never)} />}
        ListEmptyComponent={(
          <View className="flex-1 items-center justify-center px-8 py-12">
            {loading ? <ActivityIndicator size="large" color={PRIMARY} /> : (
              <>
                <Feather name="credit-card" size={34} color="#9ca3af" />
                <Text className="mt-4 text-base font-bold text-neutral-800 dark:text-neutral-100">
                  {error ? '暂时无法显示订阅' : '暂无订阅记录'}
                </Text>
                <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  {error ? '检查网络后重试。' : '你的真实订阅记录会显示在这里。目前无法直接购买新方案。'}
                </Text>
              </>
            )}
          </View>
        )}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator className="py-5" color={PRIMARY} />
        ) : hasNextPage ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading || loadingMore}
            onPress={() => void loadPage(pageNumber + 1, true)}
            className="items-center py-5"
          >
            <Text className="font-bold text-sky-600">加载更多订阅</Text>
          </Pressable>
        ) : <View className="h-5" />}
      />
    </View>
  );
}
