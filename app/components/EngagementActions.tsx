import { Text, TouchableOpacity, View } from 'react-native';
import { useColorScheme } from "nativewind";
import Comment from "~/assets/svg/comment.svg";
import RepostButton from './RepostButton';
import BookmarkButton from './BookmarkButton';
import Views from "~/assets/svg/views.svg";
import LikeButton from './LikeButton';
import ShareButton from './ShareButton';

type EngagementData = {
    contentId?: string;
    liked?: boolean;
    reposted?: boolean;
    reply_count?: number;
    retweet_count?: number;
    like_count?: number;
    view_count?: string;
    save_count?: number;
    message?: string;
};

export const EngagementActions = ({ detailView, itemData }: { detailView?: boolean; itemData?: EngagementData }) => {
    const { colorScheme } = useColorScheme();
    const iconColor = colorScheme === 'dark' ? '#8b98a5' : '#536471';
    const textColor = "text-sm text-neutral-600 dark:text-neutral-400";

    

    return (
        <View className="flex-row items-center justify-between mt-2">
            <TouchableOpacity className="flex-row items-center gap-1.5">
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