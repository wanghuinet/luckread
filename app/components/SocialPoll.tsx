import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiRequest, createIdempotencyKey, getApiErrorMessage } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';

type PollOption = {
  optionId: string;
  text: string;
  position: number;
  votes: number;
};

type Poll = {
  pollId: string;
  contentId: string;
  options: PollOption[];
  durationHours: 24 | 72 | 168;
  endsAt: string | null;
  totalVotes: number;
  viewerOptionId: string | null;
  closed: boolean;
};

type PollEnvelope = {
  poll?: Poll | null;
};

const PRIMARY = '#1d9bf0';

export default function SocialPoll({ contentId }: { contentId: string }) {
  const router = useRouter();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const loadPoll = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setErrorMessage('');
    try {
      const result = await apiRequest<unknown>(
        '/contents/' + encodeURIComponent(contentId) + '/poll',
        { method: 'GET', signal },
      );
      if (signal?.aborted) return;
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, 'Could not load this poll.', result.response.status));
      }
      const payload = unwrapApiData<PollEnvelope>(result.data);
      if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'poll')) {
        throw new Error('LuckRead returned an invalid poll response.');
      }
      const value = payload.poll ?? null;
      if (value && (!Array.isArray(value.options) || !value.options.every((option) =>
        typeof option.optionId === 'string' && typeof option.text === 'string' &&
        typeof option.votes === 'number'))) {
        throw new Error('LuckRead returned invalid poll options.');
      }
      setPoll(value);
      setSelectedOptionId(value?.viewerOptionId ?? '');
      setMessage('');
    } catch (cause) {
      if (signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')) return;
      setErrorMessage(cause instanceof Error ? cause.message : 'Could not load this poll.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [contentId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPoll(controller.signal);
    return () => controller.abort();
  }, [loadPoll, refreshKey]);

  const vote = useCallback(async () => {
    if (!poll || busy || poll.closed || poll.viewerOptionId) return;
    if (!selectedOptionId) {
      setMessage('Choose an option before voting.');
      return;
    }

    setBusy(true);
    setMessage('');
    setErrorMessage('');
    try {
      const result = await apiRequest<unknown>(
        '/contents/' + encodeURIComponent(contentId) + '/poll/votes',
        {
          method: 'POST',
          body: JSON.stringify({ optionId: selectedOptionId }),
          idempotencyKey: createIdempotencyKey(),
        },
      );
      if (result.response.status === 401) {
        Alert.alert(
          'Sign in to vote',
          'Sign in to cast a vote in this poll.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign in', onPress: () => router.push('/login' as never) },
          ],
        );
        return;
      }
      if (!result.response.ok) {
        throw new Error(getApiErrorMessage(result.data, 'Vote failed. Please try again.', result.response.status));
      }
      const payload = unwrapApiData<PollEnvelope>(result.data);
      if (!payload?.poll) throw new Error('LuckRead did not return updated poll results.');
      setPoll(payload.poll);
      setSelectedOptionId(payload.poll.viewerOptionId ?? selectedOptionId);
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : 'Vote failed. Please try again.');
      // A timed-out vote may have committed. Re-read the server-authoritative state
      // so the UI cannot accidentally suggest a second vote under a different option.
      void loadPoll();
    } finally {
      setBusy(false);
    }
  }, [busy, contentId, loadPoll, poll, router, selectedOptionId]);

  if (loading && !poll) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={PRIMARY} />
      </View>
    );
  }

  if (!poll) {
    if (!errorMessage) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.title}>投票暂时不可用</Text>
        <Text style={styles.description}>{errorMessage}</Text>
        <Pressable accessibilityRole="button" onPress={() => setRefreshKey((value) => value + 1)} style={styles.retryButton}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  const showResults = Boolean(poll.viewerOptionId || poll.closed);
  const endsAt = poll.endsAt && Number.isFinite(Date.parse(poll.endsAt))
    ? new Date(poll.endsAt).toLocaleString()
    : null;

  return (
    <View accessibilityLabel="投票" style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>投票</Text>
        {poll.closed ? <Text style={styles.closedLabel}>已结束</Text> : null}
      </View>

      {poll.options.map((option) => {
        const percentage = poll.totalVotes > 0 ? Math.round(option.votes / poll.totalVotes * 100) : 0;
        const selected = selectedOptionId === option.optionId;
        const viewerVote = poll.viewerOptionId === option.optionId;
        return (
          <View key={option.optionId} style={styles.optionBlock}>
            {showResults ? (
              <View style={styles.resultHeading}>
                <Text style={[styles.optionText, viewerVote && styles.viewerVoteText]}>
                  {option.text}{viewerVote ? ' ✓' : ''}
                </Text>
                <Text style={styles.resultText}>{percentage}% · {option.votes} 票</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: busy || poll.closed }}
                disabled={busy || poll.closed}
                onPress={() => {
                  setSelectedOptionId(option.optionId);
                  setMessage('');
                }}
                style={[styles.optionButton, selected && styles.optionSelected]}
              >
                <Text style={[styles.optionText, selected && styles.optionSelectedText]}>{option.text}</Text>
              </Pressable>
            )}
            {showResults ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: (percentage + '%') as `${number}%` }]} />
              </View>
            ) : null}
          </View>
        );
      })}

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{poll.totalVotes.toLocaleString()} 票</Text>
        {endsAt ? <Text style={styles.metaText}>{poll.closed ? '截止于' : '截止时间'}：{endsAt}</Text> : null}
      </View>

      {!showResults && !poll.closed ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !selectedOptionId}
          onPress={() => { void vote(); }}
          style={[styles.voteButton, (busy || !selectedOptionId) && styles.voteButtonDisabled]}
        >
          {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.voteButtonText}>投票</Text>}
        </Pressable>
      ) : null}

      {message ? <Text accessibilityLiveRegion="polite" style={styles.description}>{message}</Text> : null}
      {errorMessage && poll ? <Text accessibilityLiveRegion="assertive" style={styles.inlineError}>{errorMessage}</Text> : null}
      {errorMessage && poll ? (
        <Pressable accessibilityRole="button" onPress={() => setRefreshKey((value) => value + 1)} style={styles.retryButton}>
          <Text style={styles.retryText}>刷新投票状态</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 10, alignItems: 'flex-start' },
  card: { marginTop: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d0d5dd', borderRadius: 14, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '800', color: '#101828' },
  closedLabel: { fontSize: 12, color: '#667085' },
  optionBlock: { marginBottom: 8 },
  optionButton: { minHeight: 42, justifyContent: 'center', borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  optionSelected: { borderColor: PRIMARY, backgroundColor: '#eff8ff' },
  optionText: { color: '#344054', fontSize: 14, fontWeight: '600' },
  optionSelectedText: { color: PRIMARY },
  viewerVoteText: { color: PRIMARY },
  resultHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 5 },
  resultText: { color: '#667085', fontSize: 12 },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: '#eaecf0', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: PRIMARY },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 3 },
  metaText: { color: '#667085', fontSize: 12 },
  voteButton: { alignSelf: 'flex-start', minWidth: 90, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: PRIMARY, paddingHorizontal: 20, paddingVertical: 10, marginTop: 12 },
  voteButtonDisabled: { opacity: 0.55 },
  voteButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  description: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 8 },
  inlineError: { color: '#b42318', fontSize: 12, lineHeight: 18, marginTop: 8 },
  retryButton: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: '#d0d5dd' },
  retryText: { color: PRIMARY, fontSize: 12, fontWeight: '800' },
});
