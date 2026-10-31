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
  cancelWebMembershipTrial,
  fetchMySubscriptionsPage,
  type MembershipTrialSummary,
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
  TRIALING: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  PENDING: 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
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

function isTrialSummary(value: unknown): value is MembershipTrialSummary | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const trial = value as Record<string, unknown>;
  return ['WEB', 'APP_STORE', 'PLAY_STORE'].includes(String(trial.source)) &&
    ['TRIALING', 'CANCELED', 'PAYMENT_FAILED', 'CONVERTED', 'EXPIRED'].includes(String(trial.status)) &&
    typeof trial.trialEndsAt === 'string' && Number.isFinite(Date.parse(trial.trialEndsAt));
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
    typeof item.etag === 'string' && item.etag.length > 0 &&
    isTrialSummary(item.trial);
}

function SubscriptionCard({ item }: { item: MySubscription }) {
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

  useEffect(() => {
    if (authStatus !== 'loading') void loadPage(1, false);
    return () => requestRef.current?.abort();
  }, [authStatus, loadPage]);

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
          订阅状态由 W07 提供。订阅记录本身不证明付款已完成或内容权益已生效；在支付渠道、续费与退款同步通过验收前，APP 仅提供真实记录查询，不开放暂停、恢复或取消操作。
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPage(1, false, true)} />}
        contentContainerStyle={{ paddingTop: 14, paddingBottom: 36, flexGrow: 1 }}
        renderItem={({ item }) => <SubscriptionCard item={item} />}
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
