import { Text, TouchableOpacity, View } from 'react-native';
import { useColorScheme } from "nativewind";
import Comment from "~/assets/svg/comment.svg";
import RepostButton from './RepostButton';
import BookmarkButton from './BookmarkButton';
import Views from "~/assets/svg/views.svg";
import LikeButton from './LikeButton';
import ShareButton from './ShareButton';
import { useReplyComposer } from './ReplyComposerProvider';

type EngagementData = {
    contentId?: string;
    authorName?: string;
    authorHandle?: string;
    authorImageUrl?: string;
    authorImageHeaders?: Record<string, string>;
    liked?: boolean;
    reposted?: boolean;
    reply_count?: number;
    retweet_count?: number;
    like_count?: number;
    view_count?: string;
    save_count?: number;
    message?: string;
};

export const EngagementActions = ({ detailView, itemData, onCommentPress, replyDisabled, onReplySubmitted }: { detailView?: boolean; itemData?: EngagementData; onCommentPress?: () => void; replyDisabled?: boolean; onReplySubmitted?: (contentId: string) => void }) => {
    const { colorScheme } = useColorScheme();
    const { openReplyComposer } = useReplyComposer();
    const handleCommentPress = (event?: { stopPropagation?: () => void }) => {
        event?.stopPropagation?.();
        if (replyDisabled) return;
        if (onCommentPress) {
            onCommentPress();
            return;
        }
        const contentId = itemData?.contentId?.trim();
        if (!contentId) return;
        openReplyComposer({
            contentId,
            parentId: null,
            authorName: itemData?.authorName?.trim() || 'LuckRead 用户',
            authorHandle: itemData?.authorHandle?.replace(/^@/, '') || 'unknown',
            authorAvatar: itemData?.authorImageUrl || null,
            authorAvatarHeaders: itemData?.authorImageHeaders,
            contentText: itemData?.message || '',
            onSubmitted: () => onReplySubmitted?.(contentId),
        });
    };
    const iconColor = colorScheme === 'dark' ? '#8b98a5' : '#536471';
    const textColor = "text-sm text-neutral-600 dark:text-neutral-400";

    return (
        <View className="flex-row items-center justify-between mt-2">
            <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Reply to post"
                accessibilityHint="Opens the floating reply composer"
                accessibilityState={{ disabled: replyDisabled || !itemData?.contentId?.trim() }}
                disabled={replyDisabled || !itemData?.contentId?.trim()}
                onPress={handleCommentPress}
                className="flex-row items-center gap-1.5"
            >
                <Comment width={18} height={18} fill={iconColor} />
                <Text className={textColor}>{itemData?.reply_count}</Text>
            </TouchableOpacity>

            <RepostButton
                contentId={itemData?.contentId}
                initialCount={itemData?.retweet_count}
                initialReposted={itemData?.reposted}
                iconColor={iconColor}
                textColor={textColor}
            />

            <LikeButton contentId={itemData?.contentId} initialLiked={itemData?.liked} iconColor={iconColor} textColor={textColor} likes={itemData?.like_count} />

            {!detailView && (
                <TouchableOpacity className="flex-row items-center gap-1.5">
                    <Views width={18} height={18} fill={iconColor} />
                    <Text className={textColor}>{itemData?.view_count}</Text>
                </TouchableOpacity>
            )}

            <BookmarkButton contentId={itemData?.contentId} iconColor={iconColor} />

            <ShareButton
                contentId={itemData?.contentId}
                contentText={itemData?.message}
                iconColor={iconColor}
            />
        </View>
    );
};
