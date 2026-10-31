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
  fetchActiveMembershipPlansPage,
  startWebMembershipTrial,
  type ActiveMembershipPlan,
  type ActiveMembershipPlanPage,
} from '~/lib/subscriptions-api';
import { useAuthStore } from '~/store/auth-store';

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
    typeof item.trialDays === 'number' && Number.isSafeInteger(item.trialDays) && item.trialDays >= 0 && item.trialDays <= 90 &&
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

function PlanCard({ item, onStartTrial, starting }: { item: ActiveMembershipPlan; onStartTrial: (plan: ActiveMembershipPlan) => void; starting: boolean }) {
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

      {item.trialDays > 0 ? (
        <View className="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/30">
          <Text className="text-sm font-bold text-sky-800 dark:text-sky-200">
            {item.trialDays} 天免费试用
          </Text>
          <Text className="mt-1 text-xs leading-5 text-sky-700 dark:text-sky-300">
            试用期结束后按上方方案价格自动续订。开始前需要账户已有有效的 Hyperswitch 自动续费授权。
          </Text>
        </View>
      ) : null}

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
      {item.trialDays > 0 ? (
        <Pressable
          accessibilityRole="button"
          disabled={starting}
          onPress={() => onStartTrial(item)}
          className="mt-4 items-center rounded-full bg-sky-500 px-4 py-3"
        >
          {starting ? <ActivityIndicator color="#ffffff" /> : (
            <Text className="font-bold text-white">开始 {item.trialDays} 天网页试用</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MembershipPlansScreen() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const [items, setItems] = useState<ActiveMembershipPlan[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const [startingTrialPlanId, setStartingTrialPlanId] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (cursor: string | null, append: boolean, pullRefresh = false) => {
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
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== 'loading') void loadPage(null, false);
    return () => requestRef.current?.abort();
  }, [authStatus, loadPage]);

  const startTrial = useCallback(async (plan: ActiveMembershipPlan) => {
    if (startingTrialPlanId) return
    setStartingTrialPlanId(plan.planId)
    setError('')
    try {
      const result = await startWebMembershipTrial(plan.planId)
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          '暂时无法开始试用。请确认账户已有有效的自动续费付款授权。',
          result.response.status,
        ))
      }
      const payload = unwrapApiData<unknown>(result.data)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('试用服务返回的数据格式无效，请刷新后检查订阅状态。')
      }
      const value = payload as Record<string, unknown>
      const subscription = value.subscription
      const trial = value.trial
      if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription) ||
          !trial || typeof trial !== 'object' || Array.isArray(trial)) {
        throw new Error('试用服务未返回有效的订阅记录。')
      }
      const sub = subscription as Record<string, unknown>
      const trialRecord = trial as Record<string, unknown>
      if (sub.status !== 'TRIALING' || sub.planId !== plan.planId ||
          trialRecord.source !== 'WEB' || trialRecord.status !== 'TRIALING' ||
          trialRecord.planId !== plan.planId || trialRecord.subscriptionId !== sub.subscriptionId ||
          trialRecord.trialEndsAt !== sub.currentPeriodEnd) {
        throw new Error('服务端试用状态与套餐不匹配，请刷新我的订阅。')
      }
      router.push('/subscriptions' as never)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '试用申请失败，请稍后重试。')
    } finally {
      setStartingTrialPlanId(null)
    }
  }, [router, startingTrialPlanId])

  const openLogin = useCallback(() => {
    router.push(('/login?returnTo=' + encodeURIComponent('/membership-plans')) as never);
  }, [router]);

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
          <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">会员方案</Text>
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
          以下方案来自 W07 已发布的公开会员目录。具备试用天数的方案可申请网页试用，但必须已有有效的自动续费付款授权；试用期结束后会按方案价格扣款。App Store / Google Play 购买仍由商店支付通道处理，本页不模拟商店购买。
        </Text>
      </View>

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
        renderItem={({ item }) => <PlanCard item={item} onStartTrial={startTrial} starting={startingTrialPlanId === item.planId} />}
        ListEmptyComponent={(
          <View className="flex-1 items-center justify-center px-8 py-12">
            {loading ? <ActivityIndicator size="large" color={PRIMARY} /> : (
              <>
                <Feather name="award" size={34} color="#9ca3af" />
                <Text className="mt-4 text-base font-bold text-neutral-800 dark:text-neutral-100">
                  {error ? '暂时无法显示会员方案' : '暂无公开会员方案'}
                </Text>
                <Text className="mt-2 text-center text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  {error ? '检查网络后重试。' : '创作者发布公开会员方案后，会显示在这里。'}
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
