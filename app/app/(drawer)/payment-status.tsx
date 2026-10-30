import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import {
  fetchMyPaymentStatus,
  type MyPaymentStatusData,
  type PaymentAttemptStatus,
} from '~/lib/subscriptions-api';
import { useAuthStore } from '~/store/auth-store';

const PRIMARY = '#1d9bf0';
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;

const STATUS_LABELS: Record<PaymentAttemptStatus, string> = {
  INITIATING: '支付请求已建立，等待服务商处理',
  requires_payment_method: '等待付款方式确认',
  requires_confirmation: '等待支付确认',
  requires_customer_action: '需要完成支付验证',
  requires_merchant_action: '等待商户处理',
  requires_capture: '等待完成扣款',
  processing: '支付处理中',
  succeeded: '支付成功（W07 已保存服务端状态）',
  failed: '支付失败',
  cancelled: '支付已取消',
  cancelled_post_capture: '扣款后已取消，需要进一步核对',
  partially_captured: '已部分扣款',
  partially_captured_and_capturable: '已部分扣款，仍有可扣款余额',
  expired: '支付已过期',
};

const formatDate = (value: string | null): string => {
  if (!value) return '—';
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

function isPaymentStatus(value: unknown, expectedId: string): value is MyPaymentStatusData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (
    data.statusAuthority !== 'W07_D1_04' ||
    !data.payment || typeof data.payment !== 'object' || Array.isArray(data.payment) ||
    !['MATCH', 'DIFFERS', 'UNAVAILABLE'].includes(String(data.providerStatusCheck)) ||
    !(data.providerCheckedAt === null || (typeof data.providerCheckedAt === 'string' && Number.isFinite(Date.parse(data.providerCheckedAt))))
  ) return false;

  const payment = data.payment as Record<string, unknown>;
  if (
    payment.paymentId !== expectedId ||
    typeof payment.orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(payment.orderId) ||
    typeof payment.amountMinor !== 'number' || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0 ||
    typeof payment.currency !== 'string' || !/^[A-Z]{3}$/.test(payment.currency) ||
    typeof payment.status !== 'string' || !Object.hasOwn(STATUS_LABELS, payment.status) ||
    typeof payment.version !== 'number' || !Number.isSafeInteger(payment.version) || payment.version < 1 ||
    !(payment.providerUpdatedAt === null || (typeof payment.providerUpdatedAt === 'string' && Number.isFinite(Date.parse(payment.providerUpdatedAt)))) ||
    typeof payment.createdAt !== 'string' || !Number.isFinite(Date.parse(payment.createdAt)) ||
    typeof payment.updatedAt !== 'string' || !Number.isFinite(Date.parse(payment.updatedAt))
  ) return false;

  const providerStatus = data.providerStatus;
  if (!(providerStatus === null || (typeof providerStatus === 'string' && Object.hasOwn(STATUS_LABELS, providerStatus) && providerStatus !== 'INITIATING'))) {
    return false;
  }
  if (data.providerStatusCheck === 'MATCH' && (providerStatus === null || providerStatus !== payment.status || data.providerCheckedAt === null)) return false;
  if (data.providerStatusCheck === 'DIFFERS' && (providerStatus === null || providerStatus === payment.status || data.providerCheckedAt === null)) return false;
  if (data.providerStatusCheck === 'UNAVAILABLE' && providerStatus !== null) return false;
  return true;
}

export default function PaymentStatusScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentId?: string | string[] }>();
  const authStatus = useAuthStore((state) => state.status);
  const paymentId = typeof params.paymentId === 'string' ? params.paymentId : '';
  const [payment, setPayment] = useState<MyPaymentStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      setAuthRequired(true);
      setPayment(null);
      return;
    }
    if (!PAYMENT_ID_PATTERN.test(paymentId)) {
      setError('支付编号不存在或格式无效。请从账单记录重新打开支付状态查询。');
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await fetchMyPaymentStatus(paymentId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.response.status === 401) {
        setAuthRequired(true);
        setPayment(null);
        return;
      }
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data,
          '无法读取支付状态。',
          result.response.status,
        ));
      }
      const value = unwrapApiData<MyPaymentStatusData>(result.data);
      if (!value || !isPaymentStatus(value, paymentId)) {
        throw new Error('支付状态响应无法验证，请稍后重试。');
      }
      setPayment(value);
      setAuthRequired(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '无法读取支付状态。');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [authStatus, paymentId]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  if (authRequired) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-50 px-8 dark:bg-black">
        <Feather name="credit-card" size={38} color="#9ca3af" />
        <Text className="mt-4 text-lg font-extrabold text-neutral-900 dark:text-white">登录后查看支付记录</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(('/login?returnTo=' + encodeURIComponent('/payment-status?paymentId=' + paymentId)) as never)}
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
          <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">支付状态</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新支付状态"
          disabled={loading || !paymentId}
          onPress={() => void load()}
          className="rounded-full p-2"
        >
          <Feather name="refresh-cw" size={19} color={PRIMARY} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
        <Text className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
          当前支付状态来自 W07 D1-04。Hyperswitch 即时查询只是独立观察，不会仅凭浏览器回调或服务商查询直接授予会员权益。
        </Text>
        {loading && !payment ? <ActivityIndicator className="mt-6" size="large" color={PRIMARY} /> : null}
        {error ? (
          <View className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 dark:border-rose-900 dark:bg-rose-950/30">
            <Text accessibilityRole="alert" className="text-sm leading-5 text-rose-700 dark:text-rose-300">{error}</Text>
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => void load()} className="mt-3">
              <Text className="font-bold text-sky-600">重试查询</Text>
            </Pressable>
          </View>
        ) : null}
        {payment ? (
          <View className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
            <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500">LuckRead 保存的支付状态</Text>
            <Text className="mt-2 text-lg font-extrabold text-neutral-900 dark:text-white">
              {STATUS_LABELS[payment.payment.status]}
            </Text>
            <Text className="mt-4 text-xs text-neutral-500">支付金额</Text>
            <Text className="mt-1 text-2xl font-extrabold text-neutral-900 dark:text-white">
              {formatMoney(payment.payment.amountMinor, payment.payment.currency)}
            </Text>
            <View className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <Text className="text-xs text-neutral-500">订单编号</Text>
              <Text selectable className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">{payment.payment.orderId}</Text>
              <Text className="mt-3 text-xs text-neutral-500">支付编号</Text>
              <Text selectable className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-100">{payment.payment.paymentId}</Text>
              <Text className="mt-3 text-xs text-neutral-500">服务器更新时间</Text>
              <Text className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{formatDate(payment.payment.updatedAt)}</Text>
            </View>
            <View className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <Text className="text-xs font-bold text-neutral-500">Hyperswitch 即时状态观察</Text>
              <Text className="mt-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {payment.providerStatus ? STATUS_LABELS[payment.providerStatus] : '暂时不可用'}
              </Text>
              {payment.providerStatusCheck === 'MATCH' ? (
                <Text className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">与 W07 已保存状态一致。</Text>
              ) : payment.providerStatusCheck === 'DIFFERS' ? (
                <Text className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                  服务商观察状态与本地记录不同。系统以 D1-04 已保存状态为准，等待签名事件核对。
                </Text>
              ) : (
                <Text className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">无法获取服务商即时状态，上方仍显示 W07 最后保存状态。</Text>
              )}
              <Text className="mt-2 text-xs text-neutral-400">服务商检查时间：{formatDate(payment.providerCheckedAt)}</Text>
            </View>
            <Text className="mt-4 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
              支付记录本身不会直接开通会员内容权益；权益状态仍以 W07 后端订阅与权益流程为准。
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void load()}
              className="mt-5 items-center rounded-full border border-neutral-300 px-5 py-3 dark:border-neutral-700"
            >
              <Text className="font-bold text-sky-600">{loading ? '正在刷新…' : '刷新支付状态'}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
