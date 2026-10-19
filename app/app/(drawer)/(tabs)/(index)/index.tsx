import React, { useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Dimensions,
    FlatList,
    TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FeedItem, FeedContent, findUserById } from '~/components/FeedItem';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, MaterialTabBar } from 'react-native-collapsible-tab-view';
import Animated from 'react-native-reanimated';
import sampleFeedItems from '~/dummy/posts.json';
import users from '~/dummy/users.json';
import { StyledExpoImage } from "~/components/Image";
import X from "~/assets/svg/aside/x.svg";
import { BlurView } from 'expo-blur';
import { AntDesign } from '@expo/vector-icons';


const APP_PRIMARY_COLOR = '#1DA1F2';


const categoryTabs = ['For you', 'Following', 'Premier League', 'Design', 'React & Expo', 'Al'];


const processedFeedItems: FeedContent[] = sampleFeedItems.map((item: any): FeedContent => {

    if (typeof item.poster_id === 'string') {
        return {
            contentId: item.contentId || `post-${item.poster_id}-${Date.now()}`,
            poster_id: item.poster_id,
            posted_time: typeof item.posted_time === 'string' ? parseInt(item.posted_time, 10) :
                typeof item.posted_time === 'number' ? item.posted_time : Date.now(),
            message: item.message || '',
            media_url: item.media_url || undefined,
            like_count: item.like_count || 0,
            retweet_count: item.retweet_count || 0,
            reply_count: item.reply_count || 0,
            view_count: item.view_count || '0',
            category: item.category || 'For you'
        };
    }

    else if (typeof item.authorName === 'string') {

        const matchingUser = users.find(user => user.name === item.authorName);
        const userId = matchingUser ? matchingUser.id : '0';

        return {
            contentId: item.contentId || `post-legacy-${Date.now()}`,
            poster_id: userId,
            authorName: item.authorName,
            authorHandle: item.authorHandle,
            authorImageUrl: item.authorImageUrl,
            posted_time: typeof item.postedTime === 'string' ? parseInt(item.postedTime, 10) :
                typeof item.postedTime === 'number' ? item.postedTime : Date.now(),
            message: item.message || '',
            media_url: item.mediaUrl || undefined,
            like_count: item.likeCount || 0,
            retweet_count: item.retweetCount || 0,
            reply_count: item.replyCount || 0,
            view_count: item.viewCount || '0',
            category: item.category || 'For you'
        };
    }

    else {
        return {
            contentId: `post-unknown-${Date.now()}`,
            poster_id: '0',
            posted_time: Date.now(),
            message: 'Unknown post format',
            media_url: undefined,
            like_count: 0,
            retweet_count: 0,
            reply_count: 0,
            view_count: '0',
            category: 'For you'
        };
    }
});


const Header = () => {
    const currentUser = users[0];
    const insets = useSafeAreaInsets();

    return (
        <View style={{ paddingTop: insets.top }} className="bg-white w-full">
            <View className="flex-row items-center w-full justify-center py-3">
                <StyledExpoImage source={{ uri: currentUser.profile_picture }} className="w-10 h-10 rounded-full absolute left-4" />
                <X width={26} height={26} fill="black" />
            </View>
        </View>
    );
};


const AddPostButton = () => {
    const insets = useSafeAreaInsets();
    return (
        <TouchableOpacity className="absolute bottom-6 right-6 bg-blue-500 rounded-full 
        w-14 h-14 shadow-lg flex items-center justify-center z-10"
            style={{
                bottom: insets.bottom * 3,
            }}
        >
            <AntDesign name="plus" size={24} color="#ffffff" />
        </TouchableOpacity>
    );
};



export default function HomeScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const handleItemPress = (postId: string) => {
        router.push(`/post/${postId}`);
    };


    const feedItemsByCategory = useMemo(() => {
        const itemsByCategory: Record<string, FeedContent[]> = {};


        categoryTabs.forEach(category => {
            itemsByCategory[category] = [];
        });


        itemsByCategory['For you'] = [...processedFeedItems].sort((a, b) => {
            const timeA = typeof a.posted_time === 'number' ? a.posted_time : parseInt(String(a.posted_time), 10);
            const timeB = typeof b.posted_time === 'number' ? b.posted_time : parseInt(String(b.posted_time), 10);
            return timeB - timeA;
        });


        processedFeedItems.forEach(item => {
            if (item.category && item.category !== 'For you') {
                if (itemsByCategory[item.category]) {
                    itemsByCategory[item.category].push(item);
                }
            }
        });

        return itemsByCategory;
    }, []);


    const renderTab = useCallback((tabName: string) => {

        const tabPosts = feedItemsByCategory[tabName] || [];


        if (tabPosts.length === 0) {
            return (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                    <Text style={{ fontSize: 18, fontWeight: '600', color: '#555' }}>
                        You are all caught up.
                    </Text>
                </View>
            );
        }

        const renderFeedItem = ({ item }: { item: FeedContent }) => (
            <FeedItem itemData={item} onPress={() => handleItemPress(item.contentId || '')} />
        );

        return (
            <Tabs.FlatList
                data={tabPosts}
                renderItem={renderFeedItem}
                keyExtractor={(item) => {

                    return `${tabName}-${item.contentId || `post-${item.poster_id}-${item.posted_time}`}`;
                }}
                contentContainerStyle={{
                    paddingBottom: insets.bottom,
                }}
            />
        );
    }, [insets.bottom, feedItemsByCategory]);


    const renderTabBar = (props: any) => (
        <MaterialTabBar
            {...props}
            indicatorStyle={{ backgroundColor: APP_PRIMARY_COLOR, height: 3, borderRadius: 50 }}
            activeColor="black"
            scrollEnabled={true}
            style={{
                paddingHorizontal: 16,
                textAlign: 'center',
                elevation: 0, shadowOpacity: 0, borderBottomWidth: 0,
                backgroundColor: 'white',
            }}

            labelStyle={{
                marginHorizontal: 10,
                opacity: 1,
                fontWeight: 'bold', textTransform: 'capitalize', textAlign: 'center', height: 24,
                fontSize: 15,
                color: '#606E79'
            }}

        />
    );

    return (
        <BlurView style={styles.container} className="flex-1" intensity={80} tint={"light"}>

            <AddPostButton />
            <Tabs.Container

                renderHeader={Header}
                renderTabBar={renderTabBar}
                pagerProps={{ scrollEnabled: true }}
                initialTabName="For you"
                minHeaderHeight={-60}
                revealHeaderOnScroll

                headerContainerStyle={{
                    backgroundColor: 'transparent',
                    elevation: 0,
                    shadowOpacity: 0,
                }}
            >
                {categoryTabs.map((tab) => (
                    <Tabs.Tab name={tab} key={tab}>
                        {renderTab(tab)}
                    </Tabs.Tab>
                ))}
            </Tabs.Container>
        </BlurView>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'white',
        width: '100%',
        height: '100%',
    },
});