import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import {
  changeMyCreatorPlanLifecycle, createMyCreatorPlan, fetchMyCreatorApplication, fetchMyCreatorPlans,
  publishMyCreatorPlan, submitCreatorApplication, updateMyCreatorPlan,
  type CreatorApplication, type CreatorPlan, type CreatorPlanTerms,
} from '~/lib/creator-studio-api';
import { useAuthStore } from '~/store/auth-store';

const BLUE = '#1d9bf0';
const TYPES = [
  ['PERSONAL', '个人创作者'], ['WRITER', '文章作者'], ['VIDEO_CREATOR', '视频创作者'],
  ['DEVELOPER', '开发者'], ['ARTIST', '艺术与设计'], ['OTHER', '其他方向'],
] as const;
const makeKey = (prefix: string) => prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
const message = (r: any, fallback: string) => r.error?.message || getApiErrorMessage(r.data, fallback, r.response.status);
function Field({ label, value, onChangeText, placeholder, multiline = false, numeric = false }: any) {
  return <View className="mb-3">
    <Text className="mb-1 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#888"
      keyboardType={numeric ? 'numeric' : 'default'} multiline={multiline} maxLength={multiline ? 2000 : 120}
      textAlignVertical={multiline ? 'top' : 'center'}
      className={'rounded-xl border border-neutral-200 bg-white px-3 py-3 text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white ' + (multiline ? 'min-h-24' : 'min-h-12')} />
  </View>;
}
function Button({ title, onPress, secondary = false, disabled = false }: any) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    className={'min-h-11 items-center justify-center rounded-full px-4 py-2 ' + (secondary ? 'border border-neutral-300 dark:border-neutral-700' : 'bg-sky-500') + (disabled ? ' opacity-50' : '')}>
    <Text className={'text-sm font-bold ' + (secondary ? 'text-neutral-800 dark:text-neutral-200' : 'text-white')}>{title}</Text>
  </Pressable>;
}
function validApp(v: any): v is CreatorApplication {
  return !!v && typeof v.application_id === 'string' && ['PENDING','APPROVED','REJECTED'].includes(v.status) &&
    typeof v.grant_state === 'string' && typeof v.version === 'number' && typeof v.created_at === 'string';
}
function validPlan(v: any): v is CreatorPlan {
  return !!v && typeof v.planId === 'string' && /^plan_[a-f0-9]{64}$/.test(v.planId) &&
    typeof v.creatorId === 'string' && typeof v.name === 'string' && typeof v.tier === 'string' &&
    ['MONTHLY','YEARLY'].includes(v.billingInterval) && Number.isSafeInteger(v.priceMinor) &&
    typeof v.currency === 'string' && Array.isArray(v.benefits) &&
    ['DRAFT','ACTIVE','PAUSED','RETIRED'].includes(v.status) && typeof v.etag === 'string';
}
function priceLabel(minor: number, currency: string) {
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(minor / (10 ** digits));
  } catch { return currency + ' ' + minor; }
}

export default function CreatorStudioScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === 'dark';
  const authStatus = useAuthStore(s => s.status);
  const viewerId = useAuthStore(s => s.user?.id ?? null);
  const viewerRef = useRef<string | null>(viewerId);
  viewerRef.current = viewerId;
  const previousViewerIdRef = useRef<string | null>(viewerId);
  const isCurrentViewer = (owner: string) =>
    viewerRef.current === owner &&
    useAuthStore.getState().status === 'authenticated' &&
    useAuthStore.getState().user?.id === owner;
  const [application, setApplication] = useState<CreatorApplication | null>(null);
  const [loadedViewerId, setLoadedViewerId] = useState<string | null>(null);
  const [plans, setPlans] = useState<CreatorPlan[]>([]);
  const [creatorType, setCreatorType] = useState<string>('PERSONAL');
  const [statement, setStatement] = useState('');
  const [name, setName] = useState('');
  const [tier, setTier] = useState('supporter');
  const [interval, setInterval] = useState<'MONTHLY'|'YEARLY'>('MONTHLY');
  const [price, setPrice] = useState('900');
  const [currency, setCurrency] = useState('USD');
  const [benefits, setBenefits] = useState('会员专属内容');
  const [editing, setEditing] = useState<CreatorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated' || !viewerId) { setLoading(false); return; }
    const owner = viewerId;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const result = await fetchMyCreatorApplication({ expectedAccountId: owner });
      if (viewerRef.current !== owner) return;
      if (result.response.status === 401) { router.replace(('/login?returnTo=' + encodeURIComponent('/creator-studio')) as never); return; }
      if (!result.response.ok) throw new Error(message(result, '创作者申请状态读取失败。'));
      const payload = unwrapApiData<{ application: CreatorApplication | null }>(result.data);
      if (!payload || (payload.application !== null && !validApp(payload.application))) throw new Error('创作者申请数据格式无效。');
      setApplication(payload.application);
      if (payload.application?.status === 'APPROVED' && payload.application.grant_state === 'GRANTED') {
        const planResult = await fetchMyCreatorPlans({ limit: 50, expectedAccountId: owner });
        if (viewerRef.current !== owner) return;
        if (!planResult.response.ok) throw new Error(message(planResult, '会员方案读取失败。'));
        const page = unwrapApiData<{ docs: CreatorPlan[] }>(planResult.data);
        if (!page || !Array.isArray(page.docs) || !page.docs.every(validPlan)) throw new Error('会员方案数据格式无效。');
        setPlans(page.docs);
      } else setPlans([]);
      setLoadedViewerId(owner);
    } catch (e) { if (viewerRef.current === owner) setError(e instanceof Error ? e.message : '工作室加载失败。'); }
    finally { if (viewerRef.current === owner) { setLoading(false); setRefreshing(false); } }
  }, [authStatus, router, viewerId]);

  useEffect(() => {
    if (previousViewerIdRef.current !== viewerId) {
      previousViewerIdRef.current = viewerId;
      setApplication(null);
      setPlans([]);
      setLoadedViewerId(null);
      setEditing(null);
      setCreatorType('PERSONAL');
      setStatement('');
      setName('');
      setTier('supporter');
      setInterval('MONTHLY');
      setPrice('900');
      setCurrency('USD');
      setBenefits('会员专属内容');
      setSaving(false);
      setBusyPlan(null);
      setError('');
      setNotice('');
    }
    if (authStatus !== 'loading') void load();
    return () => { /* account identity guards late responses */ };
  }, [authStatus, load, viewerId]);

  const submitApplication = useCallback(async () => {
    if (saving) return;
    const owner = viewerId;
    if (!owner || !isCurrentViewer(owner)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const r = await submitCreatorApplication(creatorType, statement.trim(), makeKey('creator_apply'), owner);
      if (!isCurrentViewer(owner)) return;
      if (!r.response.ok) throw new Error(message(r, '申请提交失败。'));
      setNotice('申请已提交，审核状态已刷新。');
      await load();
    } catch (e) { if (isCurrentViewer(owner)) setError(e instanceof Error ? e.message : '申请提交失败。'); }
    finally { if (isCurrentViewer(owner)) setSaving(false); }
  }, [creatorType, load, saving, statement, viewerId]);

  const clearEditor = () => { setEditing(null); setName(''); setTier('supporter'); setInterval('MONTHLY'); setPrice('900'); setCurrency('USD'); setBenefits('会员专属内容'); };
  const editPlan = (p: CreatorPlan) => { setEditing(p); setName(p.name); setTier(p.tier); setInterval(p.billingInterval); setPrice(String(p.priceMinor)); setCurrency(p.currency); setBenefits(p.benefits.join('\n')); };
  const savePlan = async () => {
    if (saving) return;
    const terms: CreatorPlanTerms = {
      name: name.trim(), tier: tier.trim().toLowerCase(), billingInterval: interval,
      priceMinor: Number(price), currency: currency.trim().toUpperCase(),
      benefits: benefits.split('\n').map(x => x.trim()).filter(Boolean),
    };
    const owner = viewerId;
    if (!owner || !isCurrentViewer(owner)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const r = editing
        ? await updateMyCreatorPlan(editing.planId, editing.etag, terms, makeKey('plan_update'), owner)
        : await createMyCreatorPlan(terms, makeKey('plan_create'), owner);
      if (!isCurrentViewer(owner)) return;
      if (!r.response.ok) throw new Error(message(r, '会员方案保存失败。'));
      setNotice(editing ? '会员方案已更新。' : '会员方案草稿已创建。');
      clearEditor(); await load();
    } catch (e) { if (isCurrentViewer(owner)) setError(e instanceof Error ? e.message : '会员方案保存失败。'); }
    finally { if (isCurrentViewer(owner)) setSaving(false); }
  };

  const planAction = (p: CreatorPlan, action: 'publish'|'pause'|'resume'|'retire') => {
    const label = { publish: '发布', pause: '暂停销售', resume: '恢复销售', retire: '退役' }[action];
    Alert.alert(label + '方案？', action === 'retire' ? '退役后不可恢复，现有订阅权益不会被更改。' : '此操作只影响新订阅，不会自动更改已有订阅。',
      [{ text: '取消', style: 'cancel' }, { text: '确认', onPress: () => {
        const owner = viewerId;
        if (!owner || !isCurrentViewer(owner)) return;
        setBusyPlan(p.planId);
        void (async () => {
          try {
            const r = action === 'publish'
              ? await publishMyCreatorPlan(p.planId, p.etag, owner)
              : await changeMyCreatorPlanLifecycle(p.planId, p.etag, action, owner);
            if (!isCurrentViewer(owner)) return;
            if (!r.response.ok) throw new Error(message(r, label + '失败。'));
            setNotice('方案状态已更新。'); await load();
          } catch (e) { if (isCurrentViewer(owner)) { setError(e instanceof Error ? e.message : label + '失败。'); await load(); } }
          finally { if (isCurrentViewer(owner)) setBusyPlan(null); }
        })();
      }}]);
  };

  if (authStatus === 'loading' || loading) return <View className="flex-1 items-center justify-center bg-white dark:bg-black"><StatusBar style={dark ? 'light' : 'dark'} /><ActivityIndicator size="large" color={BLUE} /><Text className="mt-3 text-sm text-neutral-500">正在加载创作者工作室…</Text></View>;
  if (authStatus !== 'authenticated' || !viewerId) return <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black"><StatusBar style={dark ? 'light' : 'dark'} /><Text className="mb-4 text-lg font-bold text-neutral-900 dark:text-white">登录后使用创作者工作室</Text><Button title="登录" onPress={() => router.push(('/login?returnTo=' + encodeURIComponent('/creator-studio')) as never)} /></View>;
  const currentViewerDataReady = loadedViewerId === viewerId;
  const visibleApplication = currentViewerDataReady ? application : null;
  const visiblePlans = currentViewerDataReady ? plans : [];
  const qualified = visibleApplication?.status === 'APPROVED' && visibleApplication.grant_state === 'GRANTED';
  const canApply = !visibleApplication || visibleApplication.status === 'REJECTED';
  return <View className="flex-1 bg-white dark:bg-black">
    <StatusBar style={dark ? 'light' : 'dark'} />
    <View className="flex-row items-center border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} className="mr-3 h-10 w-10 items-center justify-center rounded-full"><Feather name="arrow-left" size={21} color={dark ? '#fff' : '#111'} /></Pressable>
      <View className="flex-1"><Text className="text-xl font-extrabold text-neutral-900 dark:text-white">创作者工作室</Text><Text className="text-xs text-neutral-500">资格申请 · 会员方案管理</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="刷新" onPress={() => void load(true)} className="h-10 w-10 items-center justify-center"><Feather name="refresh-cw" size={18} color={dark ? '#ddd' : '#555'} /></Pressable>
    </View>
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={BLUE} />} keyboardShouldPersistTaps="handled">
      {error ? <View className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30"><Text className="text-sm leading-6 text-rose-700 dark:text-rose-300">{error}</Text><Pressable onPress={() => void load(true)} className="mt-2 self-start"><Text className="font-bold text-rose-700">重试</Text></Pressable></View> : null}
      {notice ? <Text className="mb-4 text-sm font-semibold text-emerald-700 dark:text-emerald-400">{notice}</Text> : null}
      <View className="mb-5 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
        <Text className="text-base font-extrabold text-neutral-900 dark:text-white">创作者资格</Text>
        {visibleApplication ? <><Text className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">申请状态：{visibleApplication.status === 'PENDING' ? '等待审核' : visibleApplication.status === 'REJECTED' ? '未通过' : qualified ? '已通过，权限已生效' : '审核通过，权限确认中'}</Text><Text className="mt-1 text-xs text-neutral-500">提交时间：{new Date(visibleApplication.created_at).toLocaleString('zh-CN')}</Text>{visibleApplication.decision_reason ? <Text className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">审核反馈：{visibleApplication.decision_reason}</Text> : null}</> : <Text className="mt-2 text-sm text-neutral-500">提交创作者资格申请，审核通过并完成权限确认后即可管理会员方案。</Text>}
        {canApply ? <>
          <Text className="mb-2 mt-4 text-sm font-bold text-neutral-800 dark:text-neutral-200">创作方向</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">{TYPES.map(t => <Pressable key={t[0]} onPress={() => setCreatorType(t[0])} className={'rounded-full border px-3 py-2 ' + (creatorType === t[0] ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30' : 'border-neutral-300 dark:border-neutral-700')}><Text className="text-sm text-neutral-800 dark:text-neutral-200">{t[1]}</Text></Pressable>)}</View>
          <Field label="创作说明（最多 2000 字）" value={statement} onChangeText={setStatement} placeholder="介绍你的内容方向、创作计划与希望提供的价值…" multiline />
          <Button title={saving ? '正在提交…' : '提交创作者申请'} disabled={saving} onPress={() => void submitApplication()} />
        </> : null}
        {application?.status === 'PENDING' ? <Text className="mt-3 text-xs text-neutral-500">申请正在审核中，可以刷新查看状态。</Text> : null}
        {application?.status === 'APPROVED' && !qualified ? <Text className="mt-3 text-xs text-amber-700 dark:text-amber-400">权限授予尚未确认。请稍后刷新；权限生效前不会开放方案写入。</Text> : null}
      </View>
      {qualified ? <>
        <Text className="mb-1 text-lg font-extrabold text-neutral-900 dark:text-white">会员方案</Text>
        <Text className="mb-4 text-xs leading-5 text-neutral-500">价格使用最小货币单位（例如 USD 分）。发布、版本与审计均由服务端校验。</Text>
        <View className="mb-5 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
          <Text className="mb-3 text-base font-bold text-neutral-900 dark:text-white">{editing ? '编辑会员方案' : '创建会员方案'}</Text>
          <Field label="方案名称" value={name} onChangeText={setName} placeholder="Supporter" />
          <Field label="方案标识（小写）" value={tier} onChangeText={setTier} placeholder="supporter" />
          <View className="mb-3 flex-row gap-2"><Button title={interval === 'MONTHLY' ? '✓ 月付' : '月付'} secondary={interval !== 'MONTHLY'} onPress={() => setInterval('MONTHLY')} /><Button title={interval === 'YEARLY' ? '✓ 年付' : '年付'} secondary={interval !== 'YEARLY'} onPress={() => setInterval('YEARLY')} /></View>
          <Field label="价格（最小货币单位）" value={price} onChangeText={setPrice} placeholder="900" numeric />
          <Field label="货币代码" value={currency} onChangeText={setCurrency} placeholder="USD" />
          <Field label="会员权益（每行一项）" value={benefits} onChangeText={setBenefits} placeholder="会员专属内容" multiline />
          <View className="flex-row gap-2"><View className="flex-1"><Button title={saving ? '保存中…' : editing ? '保存修改' : '创建草稿'} disabled={saving || !name.trim() || !/^\d+$/.test(price)} onPress={() => void savePlan()} /></View>{editing ? <Button title="取消编辑" secondary disabled={saving} onPress={clearEditor} /> : null}</View>
        </View>
        {visiblePlans.length ? visiblePlans.map(p => <View key={p.planId} className="mb-3 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <View className="flex-row items-start justify-between"><View className="flex-1"><Text className="text-lg font-extrabold text-neutral-900 dark:text-white">{p.name}</Text><Text className="mt-1 text-xs text-neutral-500">{p.tier} · {p.billingInterval === 'MONTHLY' ? '月付' : '年付'}</Text></View><Text className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">{({DRAFT:'草稿',ACTIVE:'公开销售中',PAUSED:'已暂停',RETIRED:'已退役'} as const)[p.status]}</Text></View>
          <Text className="mt-3 text-xl font-extrabold text-neutral-900 dark:text-white">{priceLabel(p.priceMinor, p.currency)}</Text>
          {p.benefits.map(b => <Text key={b} className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">• {b}</Text>)}
          <View className="mt-4 flex-row flex-wrap gap-2"><Button title="编辑" secondary disabled={busyPlan === p.planId || p.status === 'RETIRED'} onPress={() => editPlan(p)} />{p.status === 'DRAFT' ? <Button title="发布" disabled={busyPlan === p.planId} onPress={() => planAction(p,'publish')} /> : null}{p.status === 'ACTIVE' ? <Button title="暂停销售" secondary disabled={busyPlan === p.planId} onPress={() => planAction(p,'pause')} /> : null}{p.status === 'PAUSED' ? <Button title="恢复销售" disabled={busyPlan === p.planId} onPress={() => planAction(p,'resume')} /> : null}{p.status !== 'RETIRED' ? <Button title="退役" secondary disabled={busyPlan === p.planId} onPress={() => planAction(p,'retire')} /> : null}</View>
        </View>) : <View className="rounded-2xl bg-neutral-50 p-5 dark:bg-neutral-900"><Text className="text-center text-sm text-neutral-500">还没有会员方案。创建第一个草稿开始配置。</Text></View>}
      </> : null}
    </ScrollView>
  </View>;
}
