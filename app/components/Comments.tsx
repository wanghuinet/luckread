import React from 'react';
import {
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useColorScheme } from "nativewind";
import { ProfileImage } from "./FeedItem";
import { router } from 'expo-router';
import Comment from "~/assets/svg/comment.svg";
import Like from "~/assets/svg/like.svg";
import LikeButton from './LikeButton';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { EngagementActions } from '~/components/EngagementActions';
import { MoreContextIcons } from "~/app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id]"


dayjs.extend(relativeTime);


export interface CommentContent {
    commentId: string;
    contentId: string; 
    authorName: string;
    authorHandle: string;
    authorImageUrl: string;
    postedTime: number; 
    message: string;
    is_organization?: boolean;
}


export const dummyComments: CommentContent[] = [
    {
        commentId: 'comment1',
        contentId: 'post1',
        authorName: 'LeBron Fanatic',
        authorHandle: 'KingJamesLoyalty',
        authorImageUrl: 'https://randomuser.me/api/portraits/women/1.jpg',
        postedTime: Date.now() - 1000 * 60 * 30, 
        message: 'This is a great post! I totally agree with your thoughts on this topic.',
    },
    {
        commentId: 'comment2',
        contentId: 'post1',
        authorName: 'Mike Kelly',
        authorHandle: 'ChicagoBullsForever',
        authorImageUrl: 'https://randomuser.me/api/portraits/men/1.jpg',
        postedTime: Date.now() - 1000 * 60 * 60 * 2, 
        message: 'Interesting perspective! Have you considered the alternative approach?',
    },
    {
        commentId: 'comment3',
        contentId: 'post1',
        authorName: 'JSGuy',
        authorHandle: 'JSGuy',
        authorImageUrl: 'https://randomuser.me/api/portraits/lego/1.jpg',
        postedTime: Date.now() - 1000 * 60 * 60 * 5, 
        message: 'We\'ve been working on similar solutions. Would love to connect and discuss further!',
        is_organization: true,
    },
    {
        commentId: 'comment4',
        contentId: 'post1',
        authorName: 'Dave Rodriguez',
        authorHandle: 'HotTakeDave',
        authorImageUrl: 'https://randomuser.me/api/portraits/men/2.jpg',
        postedTime: Date.now() - 1000 * 60 * 60 * 24, 
        message: 'I had a different experience with this. Let me share what worked for me...',
    },
    {
        commentId: 'comment5',
        contentId: 'post1',
        authorName: 'Sarah Williams',
        authorHandle: 'PatriotsSuperfan',
        authorImageUrl: 'https://randomuser.me/api/portraits/women/2.jpg',
        postedTime: Date.now() - 1000 * 60 * 60 * 24 * 2, 
        message: 'Thanks for sharing! This helped me solve a problem I\'ve been stuck on.',
    }
];


const formatTime = (timestamp: number): string => {
    const time = dayjs(timestamp);
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
};




















interface CommentItemProps {
    commentData: CommentContent;
}


export const CommentItem: React.FC<CommentItemProps> = ({ commentData }) => {
    return (
        <View className="p-1  pt-2 border-b border-neutral-100 dark:border-neutral-800">
            <View className="flex-row">
                <ProfileImage
                    source={{ uri: commentData.authorImageUrl }}
                    displaySize="xs"
                    is_organization={commentData.is_organization}
                />
                <View className="ml-2 flex-1">
                    <View className="flex-row items-center justify-between">
                        <TouchableOpacity onPress={() => router.push(`/profile/${commentData.authorHandle}`)}>
                            <View className="flex-row items-center">
                                <Text className="text-base font-bold text-black dark:text-white mr-1">{commentData.authorName}</Text>
                                <Text className="text-base text-neutral-500 dark:text-neutral-400 mr-1">@{commentData.authorHandle}</Text>
                                <Text className="text-base text-neutral-500 dark:text-neutral-400">· {formatTime(commentData.postedTime)}</Text>
                            </View>
                        </TouchableOpacity>
                        <MoreContextIcons size="sm" />
                    </View>
                    <Text className="text-black dark:text-white mt-1">{commentData.message}</Text>
                    
                    <EngagementActions />
                </View>
            </View>
        </View>
    );
};


interface CommentsProps {
    postId: string;
    comments?: CommentContent[];
}


const Comments: React.FC<CommentsProps> = ({ postId, comments = dummyComments }) => {
    
    
    
    
    const filteredComments = comments;

    return (
        <View className="mt-2">
            {filteredComments.map(comment => (
                <CommentItem key={comment.commentId} commentData={comment} />
            ))}
        </View>
    );
};

export default Comments;
