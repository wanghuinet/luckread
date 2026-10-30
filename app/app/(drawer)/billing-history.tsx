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
import { useRouter } from 'expo-router';

import { getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import {
  fetchMyCommerceOrdersPage,
  type CommerceOrderStatus,
  type MyCommerceOrderPage,
  type MyCommerceOrderSummary,
} from '~/lib/subscriptions-api';
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';

const ORDER_STATUS_LABELS: Record<CommerceOrderStatus, string> = {
  CREATED: '已创建',
  PENDING_PAYMENT: '待付款',
  CONFIRMED: '已确认',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  FAILED: '失败',
};

const formatDate = (value: string): string => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : '—';
};

const formatMoney = (amountMinor: number, currency: string): string => {
  try {
    const formatter = new Intl.NumberFormat('zh-CN', { style: 'currency', currency });
    const exponent = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(amountMinor / (10 ** exponent));
  } catch {
    return String(amountMinor) + ' ' + currency;
  }
};

function isOrderSummary(value: unknown): value is MyCommerceOrderSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const order = value as Record<string, unknown>;
  const statuses = Object.keys(ORDER_STATUS_LABELS);
  return typeof order.orderId === 'string' && /^ord_[A-Za-z0-9_-]{1,90}$/.test(order.orderId) &&
    (order.latestPaymentId === null || (typeof order.latestPaymentId === 'string' && /^pay_[A-Za-z0-9]{26}$/.test(order.latestPaymentId))) &&
    typeof order.status === 'string' && statuses.includes(order.status) &&
    Number.isSafeInteger(order.version) && Number(order.version) >= 1 &&
    typeof order.currency === 'string' && /^[A-Z]{3}$/.test(order.currency) &&
    ['subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor'].every((key) =>
      Number.isSafeInteger(order[key]) && Number(order[key]) >= 0) &&
    typeof order.createdAt === 'string' && Number.isFinite(Date.parse(order.createdAt)) &&
    typeof order.updatedAt === 'string' && Number.isFinite(Date.parse(order.updatedAt));
}

function OrderCard({ item }: { item: MyCommerceOrderSummary }) {
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500">订单编号</Text>
          <Text selectable className="mt-1 text-sm font-extrabold text-neutral-900 dark:text-white">
            {item.orderId}
          </Text>
        </View>
        <View className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 dark:border-neutral-700 dark:bg-neutral-900">
          <Text className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
            {ORDER_STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>
      <View className="mt-4 flex-row items-end justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <View>
          <Text className="text-xs text-neutral-500">订单金额</Text>
          <Text className="mt-1 text-lg font-extrabold text-neutral-900 dark:text-white">
            {formatMoney(item.totalMinor, item.currency)}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-xs text-neutral-500">创建时间</Text>
          <Text className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
            {formatDate(item.createdAt)}
          </Text>
        </View>
      </View>
      <Text className="mt-3 text-[11px] leading-4 text-neutral-400">
        订单状态不等同于支付成功凭证或内容权益记录。
      </Text>
    </View>
  );
}

export default function BillingHistoryScreen() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const [items, setItems] = useState<MyCommerceOrderSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (cursor: string | null = null, append = false, pullRefresh = false) => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setAuthRequired(true);
      setItems([]);
      setNextCursor(null);
      setHasMore(false);
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
      const result = await fetchMyCommerceOrdersPage({ limit: 20, cursor, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.response.status === 401) {
        setAuthRequired(true);
        setItems([]);
        setNextCursor(null);
        setHasMore(false);
        return;
      }
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          '账单记录读取失败，请稍后重试。',
          result.response.status,
        ));
      }

      const page = unwrapApiData<MyCommerceOrderPage>(result.data);
      if (
        !page || !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50 ||
        typeof page.hasMore !== 'boolean' ||
        !(page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length > 0 && page.nextCursor.length <= 2048)) ||
        !page.items.every(isOrderSummary)
      ) {
        throw new Error('订单历史数据格式无效，请重试。');
      }

      setItems((current) => {
        if (!append) return page.items;
        const known = new Set(current.map((item) => item.orderId));
        return [...current, ...page.items.filter((item) => !known.has(item.orderId))];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setAuthRequired(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '账单记录读取失败，请稍后重试。');
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

  useEffect(() => {
    void loadPage();
    return () => requestRef.current?.abort();
  }, [loadPage]);

  if (authRequired) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 px-8 dark:bg-black">
        <Feather name="credit-card" size={38} color="#9ca3af" />
        <Text className="mt-4 text-lg font-extrabold text-neutral-900 dark:text-white">登录后查看账单记录</Text>
        <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
          账单记录仅对当前登录账户开放。
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(('/login?returnTo=' + encodeURIComponent('/billing-history')) as never)}
          className="mt-5 rounded-full bg-sky-500 px-6 py-3"
        >
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
          <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">账单与订单</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新账单记录"
          disabled={loading || loadingMore}
          onPress={() => void loadPage()}
          className="rounded-full p-2"
        >
          <Feather name="refresh-cw" size={19} color={PRIMARY} />
        </Pressable>
      </View>
      <View className="border-b border-neutral-100 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-black">
        <Text className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          这里只显示当前账户拥有的订单摘要。订单记录不是税务发票，也不能单独证明支付成功或订阅权益已生效。
        </Text>
      </View>
      {error ? (
        <View className="mx-4 mt-3 flex-row items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 dark:border-rose-900 dark:bg-rose-950/30">
          <Text accessibilityRole="alert" className="flex-1 text-sm leading-5 text-rose-700 dark:text-rose-300">{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadPage()} disabled={loading}>
            <Text className="font-bold text-sky-600">重试</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.orderId}
        renderItem={({ item }) => <OrderCard item={item} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPage(null, false, true)} />}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 36, flexGrow: 1 }}
        ListEmptyComponent={(
          <View className="flex-1 items-center justify-center px-8 py-12">
            {loading ? <ActivityIndicator size="large" color={PRIMARY} /> : (
              <>
                <Feather name="file-text" size={34} color="#9ca3af" />
                <Text className="mt-4 text-base font-bold text-neutral-800 dark:text-neutral-100">
                  {error ? '暂时无法显示账单' : '暂无订单记录'}
                </Text>
                <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  {error ? '检查网络后重试。' : '付款订单创建后，记录会显示在这里。'}
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
            <Text className="font-bold text-sky-600">加载更多账单</Text>
          </Pressable>
        ) : <View className="h-5" />}
      />
    </View>
  );
}
