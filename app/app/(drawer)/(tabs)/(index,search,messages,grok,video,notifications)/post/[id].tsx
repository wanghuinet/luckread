import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Alert, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { FeedItem, FeedContent } from '~/components/FeedItem';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Grok from '~/assets/svg/tabs/grok.svg';
import AntDesign from '@expo/vector-icons/AntDesign';
import Comments from '~/components/Comments';
import { apiRequest, getApiErrorMessage } from '~/lib/api-client';
import { mapContentToFeedContent, readContentBody, unwrapApiData, type ApiContentRecord, type ApiContentSocial } from '~/lib/content-adapter';
import { readSessionToken } from '~/lib/secure-session';
import { blockUser, muteUser } from '~/lib/social-screen-api';
import { useAuthStore } from '~/store/auth-store';
import ReportPostDialog from '~/components/ReportPostDialog';

import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop
} from '@gorhom/bottom-sheet';
import { Feather } from '@expo/vector-icons';
import * as DropdownMenu from 'zeego/dropdown-menu';

type SortType = 'relevant' | 'recent' | 'liked';

const sortOptions: Record<SortType, string> = {
    relevant: 'Most relevant replies',
    recent: 'Most recent replies',
    liked: 'Most liked replies',
};

export const MoreContextIcons = ({
    size = "lg",
    username = "unknown_user",
    targetUserId,
    contentId,
    postId,
}: {
    size?: 'sm' | 'lg';
    username?: string;
    targetUserId?: string | null;
    contentId?: string;
    postId?: string;
}) => {
    const router = useRouter();
    const openPostInteractions = () => {
        if (!postId) return;
        router.push(('/post-interactions/' + encodeURIComponent(postId)) as never);
    };
    const [reportDialogOpen, setReportDialogOpen] = useState(false);
    const currentUserId = useAuthStore((state) => state.user?.id);
    const isOwnTarget = Boolean(targetUserId && currentUserId && targetUserId === currentUserId);

    const muteTarget = () => {
        if (!targetUserId || isOwnTarget) {
            Alert.alert('无法静音', '当前帖子未提供可验证的作者账号 ID。');
            return;
        }
        void (async () => {
            try {
                const result = await muteUser(targetUserId);
                if (!result.response.ok) throw new Error(result.error?.message || getApiErrorMessage(result.data, '静音用户失败，请稍后重试。', result.response.status));
                Alert.alert('已静音', '已静音 @' + username + '。静音不会屏蔽该用户。');
            } catch (error) {
                Alert.alert('静音失败', error instanceof Error ? error.message : '静音用户失败，请稍后重试。');
            }
        })();
    };

    const confirmBlockTarget = () => {
        if (!targetUserId || isOwnTarget) {
            Alert.alert('无法屏蔽', '当前帖子未提供可验证的作者账号 ID。');
            return;
        }
        Alert.alert('屏蔽 @' + username, '屏蔽后，LuckRead 会按服务端规则过滤双方的相关内容与互动。确定继续吗？', [
            { text: '取消', style: 'cancel' },
            {
                text: '屏蔽',
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        try {
                            const result = await blockUser(targetUserId);
                            if (!result.response.ok) throw new Error(result.error?.message || getApiErrorMessage(result.data, '屏蔽用户失败，请稍后重试。', result.response.status));
                            Alert.alert('已屏蔽', '@' + username + ' 已加入屏蔽名单。刷新信息流以同步过滤结果。');
                        } catch (error) {
                            Alert.alert('屏蔽失败', error instanceof Error ? error.message : '屏蔽用户失败，请稍后重试。');
                        }
                    })();
                },
            },
        ]);
    };

    return (
        <View className="flex-row items-center gap-3  ">
            <TouchableOpacity onPress={() => { router.back() }}>
                <Grok width={size === 'sm' ? 18 : 22} height={size === 'sm' ? 18 : 22} fill={'#536471'} />
            </TouchableOpacity>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                    <TouchableOpacity>
                        <Feather name="more-horizontal" size={size === 'sm' ? 18 : 22} color={'#536471'} />
                    </TouchableOpacity>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                    <DropdownMenu.Item key="interactions" onSelect={openPostInteractions} disabled={!postId}>
                        <DropdownMenu.ItemTitle>View post interactions</DropdownMenu.ItemTitle>
                        <DropdownMenu.ItemIcon
                            ios={{ name: 'chart.bar.xaxis' }}
                        />
                    </DropdownMenu.Item>
                    <DropdownMenu.Item key="report" onSelect={() => setReportDialogOpen(true)} disabled={!contentId}>
                        <DropdownMenu.ItemTitle>Report post</DropdownMenu.ItemTitle>
                        <DropdownMenu.ItemIcon
                            ios={{ name: 'flag' }}
                        />
                    </DropdownMenu.Item><DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger key="user-actions">
                            <DropdownMenu.ItemTitle>@{username}</DropdownMenu.ItemTitle>
                            
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.SubContent><DropdownMenu.Item key="mute" onSelect={muteTarget} disabled={!targetUserId || isOwnTarget}>
                                <DropdownMenu.ItemTitle>Mute @{username}</DropdownMenu.ItemTitle>
                                <DropdownMenu.ItemIcon ios={{ name: 'speaker.slash' }} />
                            </DropdownMenu.Item>
                            <DropdownMenu.Item key="block" destructive onSelect={confirmBlockTarget} disabled={!targetUserId || isOwnTarget}>
                                <DropdownMenu.ItemTitle>Block @{username}</DropdownMenu.ItemTitle>
                                <DropdownMenu.ItemIcon ios={{ name: 'nosign' }} />
                            </DropdownMenu.Item>
                        </DropdownMenu.SubContent>
                    </DropdownMenu.Sub>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
            <ReportPostDialog
                visible={reportDialogOpen}
                contentId={contentId}
                onClose={() => setReportDialogOpen(false)}
            />
        </View>
    );
};

const PostHeader = ({ username, targetUserId, contentId, postId }: { username?: string; targetUserId?: string | null; contentId: string; postId: string }) => {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    return (
        <View className="p-4  top-0 left-0 right-0 flex-row items-center justify-center">

            <TouchableOpacity onPress={() => { router.back() }} className="absolute left-4">
                <Feather name="arrow-left" size={22} color={'#536471'} />
            </TouchableOpacity>

            <Text className="text-xl font-bold text-black dark:text-white">Post</Text>

            <View className="absolute right-4">
                <MoreContextIcons username={username} targetUserId={targetUserId} contentId={contentId} postId={postId} />
            </View>
        </View>
    );
};



type ContentDetailResponse = ApiContentRecord & {
    data?: ApiContentRecord;
    error?: { code?: string; message?: string };
};
type SocialResponse = {
    data?: ApiContentSocial;
    error?: { code?: string; message?: string };
};
type PublicAuthor = {
    id: string;
    username?: string;
    displayName?: string | null;
    avatar?: string | null;
};

export default function PostDetailScreen() {
    const params = useLocalSearchParams();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const rawId = params.id;
    const postId = Array.isArray(rawId) ? rawId[0] || '' : rawId || '';
    const [selectedSort, setSelectedSort] = useState<SortType>('relevant');
    const [findPost, setFindPost] = useState<FeedContent | null>(null);
    const [membershipRequired, setMembershipRequired] = useState(false);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [retryKey, setRetryKey] = useState(0);
    const bottomSheetModalRef = useRef<BottomSheetModal>(null);
    const scrollViewRef = useRef<ScrollView | null>(null);
    const commentsOffsetRef = useRef(0);
    const snapPoints = useMemo(() => ['25%', '30%'], []);

    const handlePresentModalPress = useCallback(() => {
        bottomSheetModalRef.current?.present();
    }, []);

    const handleScrollToComments = useCallback(() => {
        scrollViewRef.current?.scrollTo({ y: commentsOffsetRef.current, animated: true });
    }, []);const handleSelectSort = useCallback((sortType: SortType) => {
        setSelectedSort(sortType);
        bottomSheetModalRef.current?.dismiss();
    }, []);

    useEffect(() => {
        if (!postId) {
            setErrorMessage('The post ID is missing.');
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        let active = true;
        setLoading(true);
        setErrorMessage('');
        setFindPost(null);
        setMembershipRequired(false);

        void (async () => {
            try {
                const { response, data } = await apiRequest<ContentDetailResponse>(
                    '/contents/' + encodeURIComponent(postId),
                    { method: 'GET', signal: controller.signal },
                );
                const record = unwrapApiData<ApiContentRecord>(data);
                if (!response.ok || !record || typeof record.id !== 'string') {
                    throw new Error(getApiErrorMessage(data, 'Could not load this post. Please retry.'));
                }
                if (record.id !== postId) {
                    throw new Error('The content service returned a different content ID.');
                }

                const creatorId = record.creatorId || record.ownerUserId || record.creator?.id || record.author?.id;
                const tasks: Promise<unknown>[] = [
                    apiRequest<SocialResponse>(
                        '/contents/' + encodeURIComponent(postId) + '/social',
                        { method: 'GET', signal: controller.signal },
                    ).catch(() => null),
                ];
                if (creatorId && !record.creator?.username && !record.author?.username) {
                    tasks.push(
                        apiRequest<PublicAuthor & { error?: { message?: string } }>(
                            '/users/' + encodeURIComponent(creatorId),
                            { method: 'GET', signal: controller.signal },
                        ).catch(() => null),
                    );
                }

                const [socialResult, authorResult] = await Promise.all(tasks);
                if (!active || controller.signal.aborted) return;

                const socialResponse = socialResult as { response?: Response; data?: unknown } | null;
                const social = socialResponse?.response?.ok
                    ? unwrapApiData<ApiContentSocial>(socialResponse.data)
                    : null;
                let hydratedRecord = record;
                if (authorResult && typeof authorResult === 'object' && 'response' in authorResult) {
                    const profileResult = authorResult as { response?: Response; data?: unknown };
                    const profile = profileResult.response?.ok
                        ? unwrapApiData<PublicAuthor>(profileResult.data)
                        : null;
                    if (profile?.id) {
                        hydratedRecord = { ...record, creator: profile };
                    }
                }

                const sessionToken = await readSessionToken().catch(() => null);
                if (!active || controller.signal.aborted) return;
                const accessRequired = hydratedRecord.accessMode === 'MEMBERS_ONLY' &&
                    hydratedRecord.accessGranted !== true;
                const body = await readContentBody(hydratedRecord, controller.signal, sessionToken);
                if (!active || controller.signal.aborted) return;
                setMembershipRequired(accessRequired);
                setFindPost(mapContentToFeedContent(hydratedRecord, body, social, null, sessionToken));
            } catch (error) {
                if (!active || controller.signal.aborted) return;
                setErrorMessage(error instanceof Error ? error.message : 'Could not load this post. Please retry.');
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
            controller.abort();
        };
    }, [postId, retryKey]);

    const authorHandle = findPost?.authorHandle || findPost?.poster_id || undefined;
    const membershipCreatorId = findPost?.creatorId;
    const hasMembershipCreator = typeof membershipCreatorId === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(membershipCreatorId);
    const openMembershipPlans = useCallback(() => {
        const creatorId = findPost?.creatorId;
        if (typeof creatorId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(creatorId)) return;
        const query = new URLSearchParams({
            creatorId,
            returnTo: '/post/' + postId,
        });
        router.push(('/membership-plans?' + query.toString()) as never);
    }, [findPost?.creatorId, postId, router]);

    if (loading) {
        return (
            <View className="flex-1 justify-center items-center bg-white dark:bg-black" style={{ paddingTop: insets.top }}>
                <Text className="text-neutral-500 dark:text-neutral-400">Loading post…</Text>
            </View>
        );
    }

    if (errorMessage || !findPost) {
        return (
            <View className="flex-1 justify-center items-center bg-white dark:bg-black px-6" style={{ paddingTop: insets.top }}>
                <Text className="text-neutral-500 dark:text-neutral-400 text-center">{errorMessage || 'Post not found.'}</Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    className="mt-4 rounded-full bg-sky-500 px-5 py-3"
                    onPress={() => setRetryKey((value) => value + 1)}
                >
                    <Text className="font-bold text-white">Retry</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <>
            <ScrollView
                ref={scrollViewRef}
                className="flex-1 bg-white dark:bg-black"
                style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
                contentContainerStyle={{ flexGrow: 1 }}
            >
                <PostHeader username={authorHandle} targetUserId={findPost.creatorId || findPost.ownerUserId} contentId={postId} postId={postId} />
                <FeedItem itemData={findPost} detailView onCommentPress={membershipRequired ? undefined : handleScrollToComments} />
                {membershipRequired ? (
                    <View className="mx-4 my-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
                        <View className="flex-row items-center gap-2">
                            <Feather name="lock" size={19} color="#b45309" />
                            <Text className="text-base font-extrabold text-amber-900 dark:text-amber-200">该内容为会员专享</Text>
                        </View>
                        <Text className="mt-2 text-sm leading-6 text-amber-900/80 dark:text-amber-100/80">
                            订阅这位创作者的有效会员方案后，即可解锁完整正文和媒体内容。支付提交成功不等于权益已经生效，返回本页时会重新检查服务端权限。
                        </Text>
                        {hasMembershipCreator ? (
                            <TouchableOpacity
                                accessibilityRole="button"
                                onPress={openMembershipPlans}
                                className="mt-4 min-h-11 items-center justify-center rounded-full bg-sky-500 px-5 py-3"
                            >
                                <Text className="font-bold text-white">查看创作者会员方案</Text>
                            </TouchableOpacity>
                        ) : (
                            <Text className="mt-3 text-sm leading-5 text-amber-900 dark:text-amber-200">
                                当前内容暂时无法匹配已验证的创作者会员方案，请稍后重试。
                            </Text>
                        )}
                    </View>
                ) : (
                    <View
                        className="px-4 mt-2"
                        onLayout={(event) => {
                            commentsOffsetRef.current = event.nativeEvent.layout.y;
                        }}
                    >
                        <TouchableOpacity
                            onPress={handlePresentModalPress}
                            className="flex-row items-center mb-3"
                        >
                            <Text className="text-base font-bold text-neutral-500 dark:text-blue-400 mr-1">
                                {sortOptions[selectedSort]}
                            </Text>
                            <Feather name="chevron-down" size={18} color={'#536471'} />
                        </TouchableOpacity>
                        <Comments contentId={postId} sort={selectedSort} />
                    </View>
                )}
            </ScrollView>

            <BottomSheetModal
                ref={bottomSheetModalRef}
                index={1}
                snapPoints={snapPoints}backdropComponent={props => (
                    <BottomSheetBackdrop
                        {...props}
                        appearsOnIndex={0}
                        disappearsOnIndex={-1}
                    />
                )}
                handleIndicatorStyle={{ backgroundColor: '#EEF3F4', height: 5, width: 35 }}
                backgroundStyle={{ backgroundColor: '#ffffff', borderRadius: 30 }}
            >
                <BottomSheetView style={styles.contentContainer}>
                    <Text className="text-lg font-extrabold text-black dark:text-white text-center">Sort replies</Text>
                    {Object.entries(sortOptions).map(([key, value]) => (
                        <TouchableOpacity
                            key={key}
                            onPress={() => handleSelectSort(key as SortType)}
                            className="flex-row justify-between items-center py-3 px-4"
                        >
                            <Text className="text-base font-semibold text-black dark:text-white">{value}</Text>
                            {selectedSort === key ? (
                                <View className="w-[22px] h-[22px] bg-[#1D9BF0] flex items-center justify-center rounded-full">
                                    <Feather name="check" size={16} color={'white'} />
                                </View>
                            ) : (
                                <View className="w-[22px] h-[22px] border-2 border-gray-400 rounded-full" />
                            )}
                        </TouchableOpacity>
                    ))}
                </BottomSheetView>
            </BottomSheetModal>
        </>
    );
}

const styles = StyleSheet.create({
    contentContainer: {
        flex: 1,
        padding: 4,
    },
});