import React, { useReducer, Reducer, useState } from 'react';
import {
    Text,
    TouchableOpacity,
    View,
    ActivityIndicator,
    Platform,
    Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColorScheme } from "nativewind";
import { StyledExpoImage as Image } from "~/components/Image"
import { Galeria } from '@nandorojo/galeria';
import Comment from "~/assets/svg/comment.svg"
import Repost from "~/assets/svg/repost.svg"
import Like from "~/assets/svg/like.svg"
import Save from "~/assets/svg/save.svg"
import Share from "~/assets/svg/share.svg"
import Views from "~/assets/svg/views.svg"
import { ImageProps } from 'expo-image';
import { router, useRouter } from 'expo-router';
import LikeButton from './LikeButton';
import FollowButton from './FollowButton';
import { VideoView, useVideoPlayer } from 'expo-video';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { EngagementActions } from './EngagementActions';
import * as ContextMenu from 'zeego/context-menu';
import * as DropdownMenu from 'zeego/dropdown-menu';
import { apiRequest, getApiErrorMessage } from '~/lib/api-client';
import { useAuthStore } from '~/store/auth-store';
import { blockUser, muteUser } from '~/lib/social-screen-api';
import { setProfilePin, useProfilePinSnapshot } from '~/lib/profile-pin-state';
import ReportPostDialog from './ReportPostDialog';
import SocialPoll from './SocialPoll';


dayjs.extend(relativeTime);


type ProfileImageSize = 'xxs' | 'xs' | 's' | 'm' | 'l';
type ProfileImageProps = ImageProps & { displaySize?: ProfileImageSize; className?: string, is_organization?: boolean };
type ProfileImageReducerState = { isLoading: boolean; hasError: boolean };
type ProfileImageReducerActions = { type: 'loaded' } | { type: 'error' };
type ProfileImageReducer = Reducer<ProfileImageReducerState, ProfileImageReducerActions>;

const PROFILE_IMAGE_DIMENSIONS: Record<ProfileImageSize, number> = {
    xxs: 20,
    xs: 30,
    s: 40,
    m: 60,
    l: 100,
};

export const PROFILE_IMAGE_SIZE_MAP = { ...PROFILE_IMAGE_DIMENSIONS };


export type FeedMediaAttachment = {
    src: string;
    kind: 'image' | 'video';
    headers?: Record<string, string>;
};

export interface FeedContent {
    contentId?: string;
    isProfilePinned?: boolean;
    contentType?: 'article' | 'post' | 'video' | string;
    accessMode?: 'PUBLIC' | 'MEMBERS_ONLY';
    accessGranted?: boolean;
    etag?: string;
    ownerUserId?: string;
    creatorId?: string | null;
    accessMode?: 'PUBLIC' | 'MEMBERS_ONLY';
    accessGranted?: boolean;
    poster_id: string;
    authorName?: string;
    authorHandle?: string;
    authorImageUrl?: string;
    authorImageHeaders?: Record<string, string>;
    posted_time: number;
    message: string;
    media_url?: string;
    media_items?: FeedMediaAttachment[];
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    view_count?: string;
    is_organization?: boolean;
    verified_badge?: string;
    save_count?: number;
    category?: string;
}


const formatTime = (timestamp: number, isDetailView: boolean): string => {

    const time = dayjs(timestamp * 1000);

    if (isDetailView) {

        return time.format('h:mm A · MMM D, YYYY');
    } else {

        const now = dayjs();
        const diffInSeconds = now.diff(time, 'second');

        if (diffInSeconds < 60) {
            return `${diffInSeconds}s`;
        } else if (diffInSeconds < 3600) {
            return `${Math.floor(diffInSeconds / 60)}m`;
        } else if (diffInSeconds < 86400) {
            return `${Math.floor(diffInSeconds / 3600)}h`;
        } else {
            return `${Math.floor(diffInSeconds / 86400)}d`;
        }
    }
};


export const ProfileImage: React.FC<ProfileImageProps> = ({ style, displaySize = 's', className = '', is_organization = false, ...imageProps }) => {
    const [{ isLoading, hasError }, dispatch] = useReducer<ProfileImageReducer>(
        (state, action) => {
            if (action.type === 'loaded') return { isLoading: false, hasError: false };
            if (action.type === 'error') return { isLoading: false, hasError: true };
            return state;
        },
        { isLoading: true, hasError: false }
    );

    const dimension = PROFILE_IMAGE_DIMENSIONS[displaySize];
    const dimensionStyle = { width: dimension, height: dimension };

    if (hasError) {
        return <Feather name="user" size={dimension} color="grey" style={dimensionStyle} />;
    }

    return (
        <View className={`py-1.5 ${is_organization ? 'rounded-md' : 'rounded-full'}  ${className}  `}>
            {isLoading && (
                <View
                    style={dimensionStyle}
                    className="absolute justify-center items-center bg-neutral-200 dark:bg-neutral-700 rounded-md"
                >
                    <ActivityIndicator size="small" color="grey" />
                </View>
            )}
            <Image
                {...imageProps}
                onError={() => dispatch({ type: 'error' })}
                onLoad={() => dispatch({ type: 'loaded' })}
                contentFit="cover"
                style={[dimensionStyle, style]}
                className={is_organization ? 'rounded-md' : 'rounded-full'}
            />
        </View>
    );
};


const FeedVideoAttachment = ({ uri, headers }: { uri: string; headers?: Record<string, string> }) => {
    const source = headers ? { uri, headers } : uri;
    const player = useVideoPlayer(source, (instance) => {
        instance.loop = false;
    });

    return (
        <VideoView
            player={player}
            style={{ width: '100%', aspectRatio: 1 }}
            contentFit="contain"
            nativeControls
            allowsFullscreen
            allowsPictureInPicture={false}
        />
    );
};

const FeedMediaGallery = ({
    items,
    detailView = false,
}: {
    items: FeedMediaAttachment[];
    detailView?: boolean;
}) => {
    if (items.length === 0) return null;

    return (
        <View className={detailView ? "mt-4 flex-row flex-wrap gap-2" : "mt-2 flex-row flex-wrap gap-2"}>
            {items.map((media, index) => (
                <View
                    key={media.src + '-' + index}
                    className={items.length === 1
                        ? "w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900"
                        : "w-[48%] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900"}
                >
                    {media.kind === 'video' ? (
                        <FeedVideoAttachment uri={media.src} headers={media.headers} />
                    ) : (
                        <Galeria urls={[media.src]}>
                            <Galeria.Image>
                                <Image
                                    source={{ uri: media.src, headers: media.headers }}
                                    className="w-full aspect-square"
                                    contentFit="cover"
                                />
                            </Galeria.Image>
                        </Galeria>
                    )}
                </View>
            ))}
        </View>
    );
};

interface FeedItemProps {
    itemData: FeedContent;
    onPress?: () => void;
    detailView?: boolean;
    onDeleted?: (contentId: string) => void;
    onCommentPress?: () => void;
}


export const FeedItem: React.FC<FeedItemProps> = ({ itemData, onPress, detailView, onDeleted, onCommentPress }) => {
    const { colorScheme } = useColorScheme();


    const mediaItems = itemData.media_items?.length
        ? itemData.media_items
        : itemData.media_url
            ? [{ src: itemData.media_url, kind: 'image' as const }]
            : [];


    const authorName = itemData.authorName || 'LuckRead 用户';
    const authorHandle = itemData.authorHandle || 'unknown';
    const profileIdentifier = itemData.contentId && itemData.poster_id && itemData.poster_id !== 'unknown'
        ? itemData.poster_id
        : authorHandle;
    const authorImageUrl = itemData.authorImageUrl || '';
    const authorImageHeaders = itemData.authorImageHeaders;
    const isOrganization = itemData.is_organization || false;
    const verified_badge = itemData?.verified_badge;

    const router = useRouter();
    const sessionStatus = useAuthStore((state) => state.status);
    const currentUser = useAuthStore((state) => state.user);
    const [reportDialogOpen, setReportDialogOpen] = useState(false);
    const isOwnPost = sessionStatus === 'authenticated' && Boolean(itemData.contentId && currentUser?.id && (itemData.ownerUserId === currentUser.id || itemData.creatorId === currentUser.id));
    const profilePinSnapshot = useProfilePinSnapshot(isOwnPost ? currentUser?.id : null);
    const hasAuthoritativePinState = profilePinSnapshot.userId === currentUser?.id && profilePinSnapshot.loaded;
    const isProfilePinned = hasAuthoritativePinState
        ? profilePinSnapshot.contentId === itemData.contentId
        : itemData.isProfilePinned === true;

    const toggleProfilePin = () => {
        const contentId = itemData.contentId;
        if (!contentId || !isOwnPost || !currentUser?.id) return;
        if (profilePinSnapshot.loading || profilePinSnapshot.pending) {
            Alert.alert('置顶状态同步中', '请等待当前置顶操作完成后重试。');
            return;
        }
        const nextPinned = !isProfilePinned;
        void (async () => {
            const result = await setProfilePin(currentUser.id, contentId, nextPinned);
            if (!result.ok) {
                Alert.alert(
                    nextPinned ? '置顶失败' : '取消置顶失败',
                    result.message || '请刷新后重试。',
                );
                return;
            }
            Alert.alert(
                nextPinned ? '已置顶' : '已取消置顶',
                nextPinned ? '这条动态已置顶在个人主页。' : '这条动态已从个人主页移除置顶。',
            );
        })();
    };



    const beginEditOwnPost = () => {
        const contentId = itemData.contentId;
        if (!contentId || !isOwnPost) return;
        Alert.alert(
            '编辑动态',
            '为保留已发布内容的历史版本，这条动态会先下线，再进入编辑。保存后会重新发布。继续吗？',
            [
                { text: '取消', style: 'cancel' },
                { text: '下线并编辑', onPress: () => {
                    void (async () => {
                        try {
                            const readLatest = async () => {
                                const result = await apiRequest<any>('/contents/' + encodeURIComponent(contentId), { method: 'GET' });
                                if (!result.response.ok) throw new Error(result.error?.message || getApiErrorMessage(result.data, '无法读取动态当前状态。', result.response.status));
                                const envelope = result.data as any;
                                const record = envelope?.data?.id ? envelope.data : envelope?.doc?.id ? envelope.doc : envelope;
                                if (!record?.id) throw new Error('服务器未返回动态信息。');
                                if (record.ownerUserId && currentUser?.id && record.ownerUserId !== currentUser.id) {
                                    throw new Error('只能编辑自己发布的动态。');
                                }
                                return {
                                    state: typeof record.state === 'string' ? record.state : '',
                                    etag: typeof record.etag === 'string' ? record.etag : result.response.headers.get('ETag') || '',
                                    contentType: record.contentType,
                                };
                            };
                            const transition = async (to: 'UNPUBLISHED' | 'DRAFT', etag: string) => {
                                const result = await apiRequest<any>('/contents/' + encodeURIComponent(contentId) + '/state', {
                                    method: 'POST',
                                    headers: { 'If-Match': etag },
                                    idempotencyKey: 'native-post-edit-' + to.toLowerCase() + ':' + contentId + ':' + etag,
                                    body: JSON.stringify({ to }),
                                });
                                if (!result.response.ok) {
                                    throw new Error(result.error?.message || getApiErrorMessage(result.data, '无法安全切换动态状态。', result.response.status));
                                }
                                const envelope = result.data as any;
                                const record = envelope?.data ?? envelope;
                                const nextEtag = typeof record?.etag === 'string' ? record.etag : result.response.headers.get('ETag') || '';
                                if (!nextEtag) throw new Error('状态已更新但版本号未返回。再次点击编辑即可继续。');
                                return { state: typeof record?.to === 'string' ? record.to : to, etag: nextEtag, contentType: 'post' };
                            };

                            let current = await readLatest();
                            if (current.contentType !== 'post') throw new Error('当前页面只支持编辑普通社交动态。');
                            if (!current.etag) throw new Error('服务器未返回内容版本，无法安全编辑。');
                            if (current.state === 'PUBLISHED') {
                                current = await transition('UNPUBLISHED', current.etag);
                            }
                            if (current.state === 'UNPUBLISHED') {
                                current = await transition('DRAFT', current.etag);
                            }
                            if (current.state !== 'DRAFT') throw new Error('当前状态不支持编辑，请刷新信息流后重试。');
                            router.push(('/publish?contentId=' + encodeURIComponent(contentId)) as never);
                        } catch (error) {
                            Alert.alert('无法编辑动态', error instanceof Error ? error.message : '请稍后重试。');
                        }
                    })();
                } },
            ],
        );
    };

    const targetUserId = itemData.creatorId || itemData.ownerUserId || '';

    const muteAuthor = () => {
        if (!targetUserId || isOwnPost) {
            Alert.alert('无法静音', '当前内容未提供可验证的作者账号 ID。');
            return;
        }
        void (async () => {
            try {
                const result = await muteUser(targetUserId);
                if (!result.response.ok) {
                    throw new Error(result.error?.message || getApiErrorMessage(result.data, '静音用户失败，请稍后重试。', result.response.status));
                }
                Alert.alert('已静音', '已静音 @' + authorHandle + '。静音不会屏蔽该用户。');
            } catch (error) {
                Alert.alert('静音失败', error instanceof Error ? error.message : '静音用户失败，请稍后重试。');
            }
        })();
    };

    const confirmBlockAuthor = () => {
        if (!targetUserId || isOwnPost) {
            Alert.alert('无法屏蔽', '当前内容未提供可验证的作者账号 ID。');
            return;
        }
        Alert.alert(
            '屏蔽 @' + authorHandle,
            '屏蔽后，LuckRead 会按服务端规则过滤双方的相关内容与互动。确定继续吗？',
            [
                { text: '取消', style: 'cancel' },
                {
                    text: '屏蔽',
                    style: 'destructive',
                    onPress: () => {
                        void (async () => {
                            try {
                                const result = await blockUser(targetUserId);
                                if (!result.response.ok) {
                                    throw new Error(result.error?.message || getApiErrorMessage(result.data, '屏蔽用户失败，请稍后重试。', result.response.status));
                                }
                                Alert.alert('已屏蔽', '@' + authorHandle + ' 已加入屏蔽名单。刷新信息流以同步过滤结果。');
                            } catch (error) {
                                Alert.alert('屏蔽失败', error instanceof Error ? error.message : '屏蔽用户失败，请稍后重试。');
                            }
                        })();
                    },
                },
            ],
        );
    };

    const removeOwnPost = () => {
        const contentId = itemData.contentId;
        if (!contentId || !isOwnPost) return;
        Alert.alert('删除动态', '确定删除这条动态吗？删除后无法恢复。', [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => {
                void (async () => {
                    try {
                        // Always read the current ETag; the timeline version may be stale.
                        const latest = await apiRequest<any>('/contents/' + encodeURIComponent(contentId), { method: 'GET' });
                        if (!latest.response.ok) {
                            throw new Error(latest.error?.message || getApiErrorMessage(latest.data, '无法读取动态当前状态。', latest.response.status));
                        }
                        const payload = latest.data as any;
                        const record = payload?.data?.id ? payload.data : payload?.doc?.id ? payload.doc : payload;
                        if (!record?.id) throw new Error('服务器未返回动态信息。');
                        if (record.contentType && record.contentType !== 'post') throw new Error('当前页面只能删除普通社交动态。');
                        if (record.ownerUserId && currentUser?.id && record.ownerUserId !== currentUser.id) {
                            throw new Error('只能删除自己发布的动态。');
                        }
                        const etag = typeof record.etag === 'string'
                            ? record.etag
                            : latest.response.headers.get('ETag') || '';
                        if (!etag) throw new Error('服务器未返回内容版本，不能安全删除。请刷新后重试.');
                        const result = await apiRequest('/contents/' + encodeURIComponent(contentId), {
                            method: 'DELETE',
                            headers: { 'If-Match': etag },
                            idempotencyKey: 'native-content-delete:' + contentId + ':' + etag,
                        });
                        if (!result.response.ok) {
                            throw new Error(result.error?.message || getApiErrorMessage(result.data, '删除动态失败，请重试。', result.response.status));
                        }
                        onDeleted?.(contentId);
                        Alert.alert('已删除', '这条动态已删除。');
                    } catch (error) {
                        Alert.alert('删除失败', error instanceof Error ? error.message : '删除动态失败，请稍后重试。');
                    }
                })();
            } },
        ]);
    };



    const openPostInteractions = () => {
        const postId = itemData.contentId;
        if (!postId) {
            Alert.alert('无法查看帖子互动', '这条动态缺少有效的内容 ID。');
            return;
        }
        router.push(('/post-interactions/' + encodeURIComponent(postId)) as never);
    };

    const goToPost = () => {
        const postId = itemData.contentId;
        if (postId) {
            router.push(`/post/${postId}`);
        } else {
            console.warn("Post ID is missing, cannot navigate");
        }
    };

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
                <TouchableOpacity onPress={onPress} className="p-1 py-2 pr-4 border-b border-neutral-200 dark:border-neutral-800">
                    {isProfilePinned ? (
                        <View className="ml-11 mb-1 flex-row items-center gap-1">
                            <Feather name="bookmark" size={13} color={colorScheme === 'dark' ? '#a3a3a3' : '#737373'} />
                            <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Pinned</Text>
                        </View>
                    ) : null}
                    <View className="flex-row">
                        <ProfileImage source={{ uri: authorImageUrl, headers: authorImageHeaders }} displaySize="s" is_organization={isOrganization} />
                        <View className="ml-2 flex-1">

                            <View className="flex-row items-center justify-between">
                                <TouchableOpacity onPress={() => router.push(`/profile/${encodeURIComponent(profileIdentifier)}`)}>
                                    <View className="flex-row items-center">
                                        <Text className=" text-lg font-bold text-black dark:text-white mr-1">{authorName}</Text>
                                        {verified_badge && (
                                            <Image
                                                source={{ uri: verified_badge }}
                                                className="w-4 h-4"
                                                onError={(e) => console.log('Failed to load verified badge:', e.nativeEvent.error)}
                                            />
                                        )}
                                        <Text className="text-lg text-neutral-500 dark:text-neutral-400 mr-1 ml-1">@{authorHandle}</Text>
                                        <Text className="text-lg text-neutral-500 dark:text-neutral-400"> · {formatTime(itemData.posted_time, false)}</Text>
                                    </View>
                                </TouchableOpacity>

                                {!detailView && (
                                    <DropdownMenu.Root>
                                        <DropdownMenu.Trigger>
                                            <TouchableOpacity className="p-1 -m-1 opacity-70">
                                                <Feather name="more-horizontal" size={18} color={colorScheme === 'dark' ? 'white' : 'black'} />
                                            </TouchableOpacity>
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Content>
                                            {isOwnPost ? (
                                                <>
                                                    <DropdownMenu.Item
                                                        key="pin-profile-post"
                                                        onSelect={toggleProfilePin}
                                                        disabled={profilePinSnapshot.pending || profilePinSnapshot.loading}
                                                    >
                                                        <DropdownMenu.ItemTitle>
                                                            {isProfilePinned ? 'Unpin from profile' : 'Pin to profile'}
                                                        </DropdownMenu.ItemTitle>
                                                        <DropdownMenu.ItemIcon ios={{ name: 'pin' }} />
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item key="edit-own-post" onSelect={beginEditOwnPost}>
                                                        <DropdownMenu.ItemTitle>Edit post</DropdownMenu.ItemTitle>
                                                        <DropdownMenu.ItemIcon ios={{ name: 'pencil' }} />
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item key="delete-own-post" destructive onSelect={removeOwnPost}>
                                                        <DropdownMenu.ItemTitle>Delete post</DropdownMenu.ItemTitle>
                                                        <DropdownMenu.ItemIcon ios={{ name: 'trash' }} />
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Separator />
                                                </>
                                            ) : null}
                                            <DropdownMenu.Item key="interactions" onSelect={openPostInteractions} disabled={!itemData.contentId}>
                                                <DropdownMenu.ItemTitle>View post interactions</DropdownMenu.ItemTitle>
                                                <DropdownMenu.ItemIcon
                                                    ios={{ name: 'chart.bar.xaxis' }}
                                                />
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item key="report" onSelect={() => setReportDialogOpen(true)} disabled={!itemData.contentId}>
                                                <DropdownMenu.ItemTitle>Report post</DropdownMenu.ItemTitle>
                                                <DropdownMenu.ItemIcon
                                                    ios={{ name: 'flag' }}
                                                />
                                            </DropdownMenu.Item><DropdownMenu.Sub>
                                                <DropdownMenu.SubTrigger key="user-actions">
                                                    <DropdownMenu.ItemTitle>@{authorHandle}</DropdownMenu.ItemTitle>

                                                </DropdownMenu.SubTrigger>
                                                <DropdownMenu.SubContent><DropdownMenu.Item key="mute" onSelect={muteAuthor} disabled={!targetUserId || isOwnPost}>
                                                        <DropdownMenu.ItemTitle>Mute @{authorHandle}</DropdownMenu.ItemTitle>
                                                        <DropdownMenu.ItemIcon ios={{ name: 'speaker.slash' }} />
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item key="block" destructive onSelect={confirmBlockAuthor} disabled={!targetUserId || isOwnPost}>
                                                        <DropdownMenu.ItemTitle>Block @{authorHandle}</DropdownMenu.ItemTitle>
                                                        <DropdownMenu.ItemIcon ios={{ name: 'nosign' }} />
                                                    </DropdownMenu.Item>
                                                </DropdownMenu.SubContent>
                                            </DropdownMenu.Sub>

                                        </DropdownMenu.Content>
                                    </DropdownMenu.Root>
                                )}
                            </View>

                            {itemData.accessMode === 'MEMBERS_ONLY' && itemData.accessGranted !== true ? (
                                <View className="mt-2 self-start flex-row items-center gap-1 rounded-full bg-amber-50 px-2 py-1 dark:bg-amber-950/40">
                                    <Feather name="lock" size={12} color="#b45309" />
                                    <Text className="text-xs font-semibold text-amber-800 dark:text-amber-300">会员专享</Text>
                                </View>
                            ) : null}
                            <Text className="text-black dark:text-white mt-1 text-lg leading-6">{itemData.message}</Text>
                            <FeedMediaGallery items={mediaItems} />
                            {detailView && itemData.contentType === 'post' && itemData.contentId ? (
                                <SocialPoll contentId={itemData.contentId} />
                            ) : null}
                            <EngagementActions itemData={itemData} detailView={Boolean(detailView)} onCommentPress={onCommentPress} />
                        </View>
                    </View>
                </TouchableOpacity>
            </ContextMenu.Trigger>
            <ContextMenu.Content>
                <ContextMenu.Item key="view-post" onSelect={goToPost}>
                    <ContextMenu.ItemTitle>View post</ContextMenu.ItemTitle>
                    <ContextMenu.ItemIcon ios={{ name: 'doc.text' }} />
                </ContextMenu.Item>

                {isOwnPost ? (
                    <>
                        <ContextMenu.Item
                            key="pin-profile-post"
                            onSelect={toggleProfilePin}
                            disabled={profilePinSnapshot.pending || profilePinSnapshot.loading}
                        >
                            <ContextMenu.ItemTitle>
                                {isProfilePinned ? 'Unpin from profile' : 'Pin to profile'}
                            </ContextMenu.ItemTitle>
                            <ContextMenu.ItemIcon ios={{ name: 'pin' }} />
                        </ContextMenu.Item>
                        <ContextMenu.Item key="edit-own-post" onSelect={beginEditOwnPost}>
                            <ContextMenu.ItemTitle>Edit post</ContextMenu.ItemTitle>
                            <ContextMenu.ItemIcon ios={{ name: 'pencil' }} />
                        </ContextMenu.Item>
                        <ContextMenu.Item key="delete-own-post" destructive onSelect={removeOwnPost}>
                            <ContextMenu.ItemTitle>Delete post</ContextMenu.ItemTitle>
                            <ContextMenu.ItemIcon ios={{ name: 'trash' }} />
                        </ContextMenu.Item>
                    </>
                ) : null}
            </ContextMenu.Content>
            <ReportPostDialog
                visible={reportDialogOpen}
                contentId={itemData.contentId}
                onClose={() => setReportDialogOpen(false)}
            />
        </ContextMenu.Root>
    );
};


export const FeedItemDetailView: React.FC<FeedItemProps> = ({ itemData, onPress, detailView, onCommentPress }) => {
    const { colorScheme } = useColorScheme();


    const mediaItems = itemData.media_items?.length
        ? itemData.media_items
        : itemData.media_url
            ? [{ src: itemData.media_url, kind: 'image' as const }]
            : [];


    const authorName = itemData.authorName || 'LuckRead 用户';
    const authorHandle = itemData.authorHandle || 'unknown';
    const profileIdentifier = itemData.contentId && itemData.poster_id && itemData.poster_id !== 'unknown'
        ? itemData.poster_id
        : authorHandle;
    const authorImageUrl = itemData.authorImageUrl || '';
    const authorImageHeaders = itemData.authorImageHeaders;
    const isOrganization = itemData.is_organization || false;
    const verified_badge = itemData?.verified_badge;

    const router = useRouter();


    const goToPost = () => {
        const postId = itemData.contentId;
        if (postId) {
            router.push(`/post/${postId}`);
        } else {
            console.warn("Post ID is missing, cannot navigate");
        }
    };

    return (
        <View className="px-4 dark:border-neutral-800 ">


            <View className="flex-row justify-between items-center mb-3">
                <View className="flex-row items-center">
                    <ProfileImage
                        source={{ uri: authorImageUrl, headers: authorImageHeaders }}
                        displaySize="s"
                        is_organization={isOrganization}
                    />
                    <TouchableOpacity
                        onPress={() => router.push(`/profile/${encodeURIComponent(profileIdentifier)}`)}
                    >
                        <View className="flex-col">
                            <Text className="text-lg font-bold text-black dark:text-white">{authorName}</Text>
                            {verified_badge && (
                                <Image
                                    source={{ uri: verified_badge }}
                                    className="w-4 h-4 mr-1"
                                    onError={(e) => console.log('Failed to load verified badge:', e.nativeEvent.error)}
                                />
                            )}
                            <Text className="text-lg text-neutral-500 dark:text-neutral-400  ml-1">@{authorHandle}</Text>
                        </View>
                    </TouchableOpacity>
                </View>
                <FollowButton targetUsername={authorHandle} />
            </View>

            <View className="mt-2">
                <Text className="text-lg text-black dark:text-white">{itemData.message}</Text>

                <FeedMediaGallery items={mediaItems} detailView />


                <View className="flex-row items-center mt-2 gap-2">
                    <Text className="text-neutral-500 dark:text-neutral-400 mt-2 text-lg">{formatTime(itemData.posted_time, true)}</Text>
                    <Text className="text-neutral-500 dark:text-neutral-400 mt-2 text-lg"><Text className="text-black dark:text-white font-semibold">{itemData.view_count}</Text> Views</Text>
                </View>


                <View className="">
                    <EngagementActions
                        itemData={itemData}
                        detailView={true}
                        onCommentPress={onCommentPress} />
                </View>
            </View>
        </View>
    );
};
