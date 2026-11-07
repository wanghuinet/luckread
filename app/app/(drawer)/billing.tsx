import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';

import { createIdempotencyKey, getApiErrorMessage } from '~/lib/api-client';
import {
  fetchBillingDocumentsPage,
  fetchPaymentHistoryPage,
  fetchRefundHistoryPage,
  requestPaymentRefund,
  type BillingCursorPage,
  type BillingDocument,
  type PaymentHistoryItem,
  type RefundHistoryItem,
} from '~/lib/billing-api';
import { useAuthStore } from '~/store/auth-store';

type BillingTab = 'payments' | 'documents' | 'refunds';
type BillingItem = BillingDocument | PaymentHistoryItem | RefundHistoryItem;

const PAGE_SIZE = 20;
const REFUND_PENDING_STATUSES = new Set([
  'REQUESTED',
  'PENDING',
  'REVIEW',
  'RECONCILIATION_REQUIRED',
]);

const TAB_LABELS: Record<BillingTab, string> = {
  payments: '付款记录',
  documents: '发票 / 收据',
  refunds: '退款记录',
};

const REFUND_STATUS_LABELS: Record<string, string> = {
  REQUESTED: '已提交',
  PENDING: '处理中',
  SUCCEEDED: '退款成功',
  FAILED: '退款失败',
  REVIEW: '等待审核',
  RECONCILIATION_REQUIRED: '等待核对',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  succeeded: '付款成功',
  captured: '已扣款',
  partially_captured: '部分扣款',
  failed: '付款失败',
  cancelled: '已取消',
  processing: '处理中',
  requires_action: '需要操作',
  requires_payment_method: '等待付款方式',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBillingDocument(value: BillingItem): value is BillingDocument {
  return 'documentId' in value;
}

function isPaymentHistoryItem(value: BillingItem): value is PaymentHistoryItem {
  return 'paymentId' in value && 'refundedMinor' in value;
}

function unwrapPage<T>(value: unknown): BillingCursorPage<T> | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  if (!Array.isArray(data.items) || data.items.length > 50 ||
      !(data.nextCursor === null || typeof data.nextCursor === 'string') ||
      typeof data.hasMore !== 'boolean') return null;
  return {
    items: data.items as T[],
    nextCursor: data.nextCursor,
    hasMore: data.hasMore,
  };
}

function formatAmount(amountMinor: number, currency: string): string {
  try {
    const fractionDigits = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
    }).format(amountMinor / (10 ** fractionDigits));
  } catch {
    return currency + ' ' + (amountMinor / 100).toFixed(2);
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : '—';
}

function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status.toLowerCase()] ?? status;
}

function refundStatusLabel(status: string): string {
  return REFUND_STATUS_LABELS[status] ?? status;
}

function refundBalance(item: PaymentHistoryItem): number {
  return Math.max(0, item.amountMinor - item.refundedMinor);
}

function documentSummary(item: BillingDocument): string {
  const snapshot = item.snapshot;
  const lines = [
    item.documentType === 'INVOICE' ? '发票' : '收据',
    '单据编号：' + item.documentNumber,
    '订单编号：' + item.orderId,
    '金额：' + formatAmount(item.amountMinor, item.currency),
    '开具时间：' + formatDate(item.issuedAt),
  ];
  if (typeof snapshot.subtotalMinor === 'number') {
    lines.push('商品小计：' + formatAmount(snapshot.subtotalMinor, item.currency));
  }
  if (typeof snapshot.taxMinor === 'number') {
    lines.push('税额：' + formatAmount(snapshot.taxMinor, item.currency));
  }
  if (Array.isArray(snapshot.items)) {
    const names = snapshot.items.slice(0, 5).map((entry) => {
      if (!isRecord(entry)) return '';
      const name = typeof entry.name === 'string'
        ? entry.name
        : typeof entry.itemRef === 'string' ? entry.itemRef : '商品项目';
      return name;
    }).filter(Boolean);
    if (names.length > 0) lines.push('项目：' + names.join('、'));
  }
  return lines.join('\n');
}

function DocumentRow({ item, onPress }: { item: BillingDocument; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={'查看' + (item.documentType === 'INVOICE' ? '发票' : '收据') + item.documentNumber}
      onPress={onPress}
      className="mx-4 mb-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Feather name="file-text" size={19} color="#1d9bf0" />
          <Text className="text-sm font-bold text-neutral-900 dark:text-white">
            {item.documentType === 'INVOICE' ? '发票' : '收据'}
          </Text>
        </View>
        <Text className="text-xs text-neutral-500">{formatDate(item.issuedAt)}</Text>
      </View>
      <Text selectable className="mt-3 text-base font-extrabold text-neutral-900 dark:text-white">
        {item.documentNumber}
      </Text>
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-neutral-500">订单 {item.orderId}</Text>
        <Text className="text-base font-bold text-neutral-900 dark:text-white">
          {formatAmount(item.amountMinor, item.currency)}
        </Text>
      </View>
      <Text className="mt-3 text-xs text-sky-600 dark:text-sky-400">查看单据详情</Text>
    </Pressable>
  );
}

function PaymentRow({
  item,
  pendingRefund,
  refundBusy,
  onRefund,
}: {
  item: PaymentHistoryItem;
  pendingRefund: boolean;
  refundBusy: boolean;
  onRefund: () => void;
}) {
  const status = item.status.toLowerCase();
  const canRefund = ['succeeded', 'captured', 'partially_captured'].includes(status) &&
    refundBalance(item) > 0 && !pendingRefund;
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-bold text-neutral-500">付款记录</Text>
          <Text selectable className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
            {item.orderId}
          </Text>
        </View>
        <Text className="text-xs font-bold text-neutral-600 dark:text-neutral-300">
          {paymentStatusLabel(item.status)}
        </Text>
      </View>
      <Text className="mt-3 text-xl font-extrabold text-neutral-900 dark:text-white">
        {formatAmount(item.amountMinor, item.currency)}
      </Text>
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-neutral-500">已退 {formatAmount(item.refundedMinor, item.currency)}</Text>
        <Text className="text-xs text-neutral-500">{formatDate(item.createdAt)}</Text>
      </View>
      <Text selectable className="mt-2 text-[11px] text-neutral-400">付款 ID：{item.paymentId}</Text>
      {pendingRefund ? (
        <Text className="mt-3 text-xs font-semibold text-amber-600">该笔付款已有退款申请待确认</Text>
      ) : canRefund ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="申请全额退款"
          disabled={refundBusy}
          onPress={onRefund}
          className="mt-4 min-h-10 flex-row items-center justify-center rounded-full border border-rose-500 px-4 py-2"
        >
          {refundBusy ? <ActivityIndicator size="small" color="#e11d48" /> : null}
          <Text className="ml-2 text-sm font-bold text-rose-600 dark:text-rose-400">
            申请可退余额退款（{formatAmount(refundBalance(item), item.currency)}）
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function RefundRow({ item }: { item: RefundHistoryItem }) {
  return (
    <View className="mx-4 mb-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-neutral-900 dark:text-white">
          {refundStatusLabel(item.status)}
        </Text>
        <Text className="text-xs text-neutral-500">{formatDate(item.createdAt)}</Text>
      </View>
      <Text className="mt-2 text-lg font-extrabold text-neutral-900 dark:text-white">
        {formatAmount(item.amountMinor, item.currency)}
      </Text>
      <Text selectable className="mt-2 text-xs text-neutral-500">订单：{item.orderId}</Text>
      <Text selectable className="mt-1 text-xs text-neutral-500">付款：{item.paymentId}</Text>
      {item.reason ? <Text className="mt-2 text-xs text-neutral-500">原因：{item.reason}</Text> : null}
      <Text selectable className="mt-2 text-[11px] text-neutral-400">退款 ID：{item.refundId}</Text>
    </View>
  );
}

export default function BillingScreen() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const [activeTab, setActiveTab] = useState<BillingTab>('payments');
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [payments, setPayments] = useState<PaymentHistoryItem[]>([]);
  const [refunds, setRefunds] = useState<RefundHistoryItem[]>([]);
  const [cursors, setCursors] = useState<Record<BillingTab, string | null>>({
    payments: null,
    documents: null,
    refunds: null,
  });
  const [more, setMore] = useState<Record<BillingTab, boolean>>({
    payments: false,
    documents: false,
    refunds: false,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const [billingDataViewerId, setBillingDataViewerId] = useState<string | null>(null);
  const [refundBusyKey, setRefundBusyKey] = useState<string | null>(null);
  const refundIdempotencyKeys = useRef(new Map<string, string>());
  const requestRef = useRef<AbortController | null>(null);
  const paginationRequestRef = useRef<AbortController | null>(null);
  const viewerIdRef = useRef<string | null>(viewerId);
  const authStatusRef = useRef(authStatus);
  const billingDataViewerIdRef = useRef<string | null>(null);
  const previousViewerIdRef = useRef<string | null>(viewerId);
  const previousAuthStatusRef = useRef(authStatus);

  useLayoutEffect(() => {
    viewerIdRef.current = viewerId;
    authStatusRef.current = authStatus;

    const identityChanged = previousViewerIdRef.current !== viewerId ||
      previousAuthStatusRef.current !== authStatus;
    if (!identityChanged) return;

    previousViewerIdRef.current = viewerId;
    previousAuthStatusRef.current = authStatus;
    requestRef.current?.abort();
    requestRef.current = null;
    paginationRequestRef.current?.abort();
    paginationRequestRef.current = null;

    billingDataViewerIdRef.current = null;
    setBillingDataViewerId(null);
    setDocuments([]);
    setPayments([]);
    setRefunds([]);
    setCursors({ payments: null, documents: null, refunds: null });
    setMore({ payments: false, documents: false, refunds: false });
    setLoading(authStatus === 'authenticated' && Boolean(viewerId));
    setRefreshing(false);
    setLoadingMore(false);
    setAuthRequired(authStatus !== 'authenticated' || !viewerId);
    setError('');
    setRefundBusyKey(null);
  }, [authStatus, viewerId]);

  const isCurrentViewerData = Boolean(viewerId) && billingDataViewerId === viewerId;
  const visibleDocuments = isCurrentViewerData ? documents : [];
  const visiblePayments = isCurrentViewerData ? payments : [];
  const visibleRefunds = isCurrentViewerData ? refunds : [];

  const pendingRefundPaymentIds = useMemo(() => new Set(
    visibleRefunds
      .filter((item) => REFUND_PENDING_STATUSES.has(item.status))
      .map((item) => item.paymentId),
  ), [visibleRefunds]);

  const openLogin = useCallback(() => {
    router.push(('/login?returnTo=' + encodeURIComponent('/billing')) as never);
  }, [router]);

  const loadAll = useCallback(async (pullRefresh = false) => {
    const requestViewerId = viewerId;
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated' || !requestViewerId) {
      requestRef.current?.abort();
      requestRef.current = null;
      paginationRequestRef.current?.abort();
      paginationRequestRef.current = null;
      billingDataViewerIdRef.current = null;
      setBillingDataViewerId(null);
      setDocuments([]);
      setPayments([]);
      setRefunds([]);
      setAuthRequired(true);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }

    requestRef.current?.abort();
    paginationRequestRef.current?.abort();
    paginationRequestRef.current = null;
    setLoadingMore(false);
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrentRequest = () => (
      !controller.signal.aborted &&
      viewerIdRef.current === requestViewerId &&
      authStatusRef.current === 'authenticated'
    );

    billingDataViewerIdRef.current = requestViewerId;
    setBillingDataViewerId(requestViewerId);
    setError('');
    if (pullRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [documentResult, paymentResult, refundResult] = await Promise.all([
        fetchBillingDocumentsPage({ limit: PAGE_SIZE, signal: controller.signal }),
        fetchPaymentHistoryPage({ limit: PAGE_SIZE, signal: controller.signal }),
        fetchRefundHistoryPage({ limit: PAGE_SIZE, signal: controller.signal }),
      ]);
      if (!isCurrentRequest()) return;

      const failed = [documentResult, paymentResult, refundResult].find((result) =>
        result.response.status === 401 || !result.response.ok,
      );
      if (failed) {
        if (failed.response.status === 401) {
          billingDataViewerIdRef.current = null;
          setBillingDataViewerId(null);
          setAuthRequired(true);
          setDocuments([]);
          setPayments([]);
          setRefunds([]);
          setCursors({ payments: null, documents: null, refunds: null });
          setMore({ payments: false, documents: false, refunds: false });
          return;
        }
        throw new Error(failed.error?.message || getApiErrorMessage(
          failed.data, '账单数据加载失败，请稍后重试。', failed.response.status,
        ));
      }

      const documentPage = unwrapPage<BillingDocument>(documentResult.data);
      const paymentPage = unwrapPage<PaymentHistoryItem>(paymentResult.data);
      const refundPage = unwrapPage<RefundHistoryItem>(refundResult.data);
      if (!documentPage || !paymentPage || !refundPage) {
        throw new Error('账单服务返回的数据格式无效，请稍后重试。');
      }

      if (!isCurrentRequest()) return;
      setDocuments(documentPage.items);
      setPayments(paymentPage.items);
      setRefunds(refundPage.items);
      setCursors({
        documents: documentPage.nextCursor,
        payments: paymentPage.nextCursor,
        refunds: refundPage.nextCursor,
      });
      setMore({
        documents: documentPage.hasMore,
        payments: paymentPage.hasMore,
        refunds: refundPage.hasMore,
      });
      setAuthRequired(false);
    } catch (cause) {
      if (isCurrentRequest()) {
        setError(cause instanceof Error ? cause.message : '账单数据加载失败，请稍后重试。');
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [authStatus, viewerId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => () => {
    requestRef.current?.abort();
    paginationRequestRef.current?.abort();
  }, []);

  const loadMore = useCallback(async () => {
    const requestViewerId = viewerId;
    const requestTab = activeTab;
    if (
      !requestViewerId ||
      !more[requestTab] ||
      loadingMore ||
      loading ||
      authStatus !== 'authenticated' ||
      viewerIdRef.current !== requestViewerId ||
      billingDataViewerIdRef.current !== requestViewerId
    ) return;
    const cursor = cursors[requestTab];
    if (!cursor || paginationRequestRef.current) return;

    const controller = new AbortController();
    paginationRequestRef.current = controller;
    const isCurrentRequest = () => (
      !controller.signal.aborted &&
      viewerIdRef.current === requestViewerId &&
      authStatusRef.current === 'authenticated' &&
      billingDataViewerIdRef.current === requestViewerId
    );

    setLoadingMore(true);
    setError('');
    try {
      const options = { limit: PAGE_SIZE, cursor, signal: controller.signal };
      const result = requestTab === 'documents'
        ? await fetchBillingDocumentsPage(options)
        : requestTab === 'payments'
          ? await fetchPaymentHistoryPage(options)
          : await fetchRefundHistoryPage(options);
      if (!isCurrentRequest()) return;

      if (result.response.status === 401) {
        billingDataViewerIdRef.current = null;
        setBillingDataViewerId(null);
        setAuthRequired(true);
        setDocuments([]);
        setPayments([]);
        setRefunds([]);
        setCursors({ payments: null, documents: null, refunds: null });
        setMore({ payments: false, documents: false, refunds: false });
        setLoadingMore(false);
        return;
      }
      if (!result.response.ok) {
        throw new Error(result.error?.message || getApiErrorMessage(
          result.data, '加载更多记录失败，请重试。', result.response.status,
        ));
      }
      const page = unwrapPage<BillingItem>(result.data);
      if (!page) throw new Error('账单服务返回的数据格式无效。');
      if (!isCurrentRequest()) return;

      if (requestTab === 'documents') {
        setDocuments((current) => [...current, ...(page.items as BillingDocument[])]);
      } else if (requestTab === 'payments') {
        setPayments((current) => {
          const known = new Set(current.map((item) => item.paymentId));
          return [...current, ...(page.items as PaymentHistoryItem[]).filter((item) => !known.has(item.paymentId))];
        });
      } else {
        setRefunds((current) => {
          const known = new Set(current.map((item) => item.refundId));
          return [...current, ...(page.items as RefundHistoryItem[]).filter((item) => !known.has(item.refundId))];
        });
      }
      setCursors((current) => ({ ...current, [requestTab]: page.nextCursor }));
      setMore((current) => ({ ...current, [requestTab]: page.hasMore }));
    } catch (cause) {
      if (isCurrentRequest()) {
        setError(cause instanceof Error ? cause.message : '加载更多记录失败，请重试。');
      }
    } finally {
      if (isCurrentRequest()) setLoadingMore(false);
      if (paginationRequestRef.current === controller) paginationRequestRef.current = null;
    }
  }, [activeTab, authStatus, cursors, loading, loadingMore, more, viewerId]);

  const handleRefund = useCallback((item: PaymentHistoryItem) => {
    const requestViewerId = viewerId;
    const amountMinor = refundBalance(item);
    if (
      amountMinor <= 0 ||
      !requestViewerId ||
      viewerIdRef.current !== requestViewerId ||
      authStatusRef.current !== 'authenticated' ||
      billingDataViewerIdRef.current !== requestViewerId
    ) return;

    const refundIdempotencyScope = requestViewerId + ':' + item.paymentId;
    const isCurrentViewer = () => (
      viewerIdRef.current === requestViewerId &&
      authStatusRef.current === 'authenticated' &&
      billingDataViewerIdRef.current === requestViewerId
    );

    Alert.alert(
      '确认申请退款',
      '将为该笔付款申请可退余额 ' + formatAmount(amountMinor, item.currency) +
        '。提交后，退款状态以支付服务商的签名回调为准；申请成功不代表退款已到账。',
      [
        { text: '暂不申请', style: 'cancel' },
        {
          text: '确认申请',
          style: 'destructive',
          onPress: () => {
            if (!isCurrentViewer()) return;
            void (async () => {
              if (!isCurrentViewer()) return;
              setRefundBusyKey(refundIdempotencyScope);
              try {
                const key = refundIdempotencyKeys.current.get(refundIdempotencyScope) ?? createIdempotencyKey();
                refundIdempotencyKeys.current.set(refundIdempotencyScope, key);
                const result = await requestPaymentRefund(
                  item.paymentId,
                  amountMinor,
                  item.currency,
                  key,
                );
                // Refund is a non-cancellable write once submitted. A switched account
                // must never receive the previous viewer's result or trigger its reload.
                if (!isCurrentViewer()) return;
                if (!result.response.ok) {
                  if ([400, 401, 403, 404, 409, 422].includes(result.response.status)) {
                    refundIdempotencyKeys.current.delete(refundIdempotencyScope);
                  }
                  throw new Error(result.error?.message || getApiErrorMessage(
                    result.data, '退款申请未能提交，请稍后重试。', result.response.status,
                  ));
                }
                const envelope = isRecord(result.data) && isRecord(result.data.data)
                  ? result.data.data
                  : null;
                const status = typeof envelope?.status === 'string' ? envelope.status : 'PENDING';
                if (status === 'FAILED') refundIdempotencyKeys.current.delete(refundIdempotencyScope);
                Alert.alert(
                  '退款申请已提交',
                  status === 'SUCCEEDED'
                    ? '支付服务已确认退款成功。'
                    : '当前状态：' + refundStatusLabel(status) + '。请以退款记录和支付服务商回调确认为准。',
                );
                await loadAll(true);
              } catch (cause) {
                if (isCurrentViewer()) {
                  Alert.alert('退款申请失败', cause instanceof Error ? cause.message : '请稍后重试。');
                }
              } finally {
                if (isCurrentViewer()) {
                  setRefundBusyKey((current) => current === refundIdempotencyScope ? null : current);
                }
              }
            })();
          },
        },
      ],
    );
  }, [loadAll, viewerId]);

  const visibleItems: BillingItem[] = activeTab === 'documents'
    ? visibleDocuments
    : activeTab === 'payments' ? visiblePayments : visibleRefunds;

  const renderItem = useCallback(({ item }: { item: BillingItem }) => {
    if (isBillingDocument(item)) {
      return (
        <DocumentRow
          item={item}
          onPress={() => Alert.alert('账单单据', documentSummary(item))}
        />
      );
    }
    if (isPaymentHistoryItem(item)) {
      return (
        <PaymentRow
          item={item}
          pendingRefund={pendingRefundPaymentIds.has(item.paymentId)}
          refundBusy={Boolean(viewerId) && refundBusyKey === viewerId + ':' + item.paymentId}
          onRefund={() => handleRefund(item)}
        />
      );
    }
    return <RefundRow item={item} />;
  }, [handleRefund, pendingRefundPaymentIds, refundBusyKey, viewerId]);

  const requiresAuthentication = authRequired || authStatus !== 'authenticated' || !viewerId;
  const currentLoading = authStatus === 'loading' || (
    authStatus === 'authenticated' && !viewerId
  ) || (
    authStatus === 'authenticated' && Boolean(viewerId) && !authRequired &&
    (!isCurrentViewerData || loading)
  );

  const keyExtractor = useCallback((item: BillingItem) => {
    if (isBillingDocument(item)) return item.documentId;
    if (isPaymentHistoryItem(item)) return item.paymentId;
    return item.refundId;
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black">
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View className="flex-row items-center border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => router.back()}
          className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        >
          <Feather name="arrow-left" size={22} color="#64748b" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xl font-extrabold text-neutral-900 dark:text-white">账单与付款</Text>
          <Text className="mt-0.5 text-xs text-neutral-500">付款、发票收据与退款记录</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新账单"
          onPress={() => void loadAll(true)}
          className="h-10 w-10 items-center justify-center rounded-full"
        >
          <Feather name="refresh-cw" size={18} color="#64748b" />
        </Pressable>
      </View>

      <View className="flex-row gap-2 px-4 py-3">
        {(Object.keys(TAB_LABELS) as BillingTab[]).map((tab) => {
          const selected = activeTab === tab;
          return (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(tab)}
              className={'flex-1 items-center rounded-full px-2 py-3 ' +
                (selected ? 'bg-sky-500' : 'bg-neutral-200 dark:bg-neutral-900')}
            >
              <Text className={'text-xs font-bold ' +
                (selected ? 'text-white' : 'text-neutral-700 dark:text-neutral-300')}>
                {TAB_LABELS[tab]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {currentLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#1d9bf0" />
          <Text className="mt-3 text-sm text-neutral-500">正在加载账单…</Text>
        </View>
      ) : requiresAuthentication ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="lock" size={34} color="#94a3b8" />
          <Text className="mt-4 text-base font-bold text-neutral-900 dark:text-white">请先登录</Text>
          <Text className="mt-2 text-center text-sm text-neutral-500">登录后查看你的付款、发票和退款记录。</Text>
          <Pressable onPress={openLogin} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
            <Text className="font-bold text-white">登录</Text>
          </Pressable>
        </View>
      ) : error && visibleItems.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="alert-circle" size={30} color="#f59e0b" />
          <Text className="mt-3 text-center text-sm text-neutral-600 dark:text-neutral-300">{error}</Text>
          <Pressable onPress={() => void loadAll(true)} className="mt-4 rounded-full bg-sky-500 px-5 py-3">
            <Text className="font-bold text-white">重新加载</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 32, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void loadAll(true)} tintColor="#1d9bf0" />
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-8 py-20">
              <Feather
                name={activeTab === 'documents' ? 'file-text' : activeTab === 'payments' ? 'credit-card' : 'rotate-ccw'}
                size={32}
                color="#94a3b8"
              />
              <Text className="mt-3 text-sm text-neutral-500">
                {activeTab === 'documents'
                  ? '暂时没有已开具的发票或收据。'
                  : activeTab === 'payments' ? '暂时没有付款记录。' : '暂时没有退款记录。'}
              </Text>
            </View>
          }
          ListFooterComponent={
            <View className="items-center px-4 py-4">
              {loadingMore ? (
                <ActivityIndicator color="#1d9bf0" />
              ) : more[activeTab] ? (
                <Pressable onPress={() => void loadMore()} className="rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700">
                  <Text className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">加载更多</Text>
                </Pressable>
              ) : visibleItems.length > 0 ? (
                <Text className="text-xs text-neutral-400">已显示全部记录</Text>
              ) : null}
              {error ? <Text className="mt-2 text-xs text-rose-600">{error}</Text> : null}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
