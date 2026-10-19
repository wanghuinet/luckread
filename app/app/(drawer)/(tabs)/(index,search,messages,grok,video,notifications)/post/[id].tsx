import React, { useState, useRef, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { FeedItem, FeedContent } from '~/components/FeedItem';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import sampleFeedItems from '~/dummy/posts.json';
import Grok from '~/assets/svg/tabs/grok.svg';
import AntDesign from '@expo/vector-icons/AntDesign';
import Comments from '~/components/Comments';
import users from '~/dummy/users.json';

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

export const MoreContextIcons = ({ size = "lg", username = "unknown_user" }: { size?: 'sm' | 'lg', username?: string }) => {
    const router = useRouter();
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
                    <DropdownMenu.Item key="interactions">
                        <DropdownMenu.ItemTitle>View post interactions</DropdownMenu.ItemTitle>
                        <DropdownMenu.ItemIcon
                            ios={{ name: 'chart.bar.xaxis' }}
                        />
                    </DropdownMenu.Item>
                    <DropdownMenu.Item key="report">
                        <DropdownMenu.ItemTitle>Report post</DropdownMenu.ItemTitle>
                        <DropdownMenu.ItemIcon
                            ios={{ name: 'flag' }}
                        />
                    </DropdownMenu.Item>
                    <DropdownMenu.Item key="community-note">
                        <DropdownMenu.ItemTitle>Request community note</DropdownMenu.ItemTitle>
                        <DropdownMenu.ItemIcon
                            ios={{ name: 'note.text' }}
                        />
                    </DropdownMenu.Item>
                    <DropdownMenu.Item key="offline">
                        <DropdownMenu.ItemTitle>Add to offline</DropdownMenu.ItemTitle>
                        <DropdownMenu.ItemIcon
                            ios={{ name: 'arrow.down.circle' }}
                        />
                    </DropdownMenu.Item>

                    <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger key="user-actions">
                            <DropdownMenu.ItemTitle>@{username}</DropdownMenu.ItemTitle>
                            
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.SubContent>
                            <DropdownMenu.Item key="add-remove">
                                <DropdownMenu.ItemTitle>Add/remove to list</DropdownMenu.ItemTitle>
                                <DropdownMenu.ItemIcon ios={{ name: 'list.bullet' }} />
                            </DropdownMenu.Item>
                            <DropdownMenu.Item key="mute">
                                <DropdownMenu.ItemTitle>Mute @{username}</DropdownMenu.ItemTitle>
                                <DropdownMenu.ItemIcon ios={{ name: 'speaker.slash' }} />
                            </DropdownMenu.Item>
                            <DropdownMenu.Item key="block" destructive>
                                <DropdownMenu.ItemTitle>Block @{username}</DropdownMenu.ItemTitle>
                                <DropdownMenu.ItemIcon ios={{ name: 'nosign' }} />
                            </DropdownMenu.Item>
                        </DropdownMenu.SubContent>
                    </DropdownMenu.Sub>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
        </View>
    );
};

const PostHeader = ({ username }: { username?: string }) => {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    return (
        <View className="p-4  top-0 left-0 right-0 flex-row items-center justify-center">

            <TouchableOpacity onPress={() => { router.back() }} className="absolute left-4">
                <Feather name="arrow-left" size={22} color={'#536471'} />
            </TouchableOpacity>

            <Text className="text-xl font-bold text-black dark:text-white">Post</Text>

            <View className="absolute right-4">
                <MoreContextIcons username={username} />
            </View>
        </View>
    );
};

const findUserById = (id: string) => {
    const user = users.find(user => user.id === id);
    return user;
};

export default function PostDetailScreen() {
    const params = useLocalSearchParams();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const postId = params.id as string;

    const [selectedSort, setSelectedSort] = useState<SortType>('relevant');

    const bottomSheetModalRef = useRef<BottomSheetModal>(null);

    const snapPoints = useMemo(() => ['25%', '30%'], []);

    const handlePresentModalPress = useCallback(() => {
        bottomSheetModalRef.current?.present();
    }, []);

    const handleSheetChanges = useCallback((index: number) => {
        console.log('handleSheetChanges', index);
    }, []);

    const handleSelectSort = useCallback((sortType: SortType) => {
        setSelectedSort(sortType);
        bottomSheetModalRef.current?.dismiss();
        console.log('Selected sort:', sortType);
    }, []);

    const findPost = useMemo(() => {
        let post = sampleFeedItems.find(item =>
            (item as any).contentId === postId
        );

        if (!post && postId.startsWith('post-')) {
            const parts = postId.split('-');
            if (parts.length >= 2) {
                const potentialPosterId = parts[1];

                post = sampleFeedItems.find(item =>
                    (item as any).poster_id === potentialPosterId
                );
            }
        }

        return post as FeedContent | undefined;
    }, [postId]);

    const authorHandle = useMemo(() => {
        if (!findPost) return undefined;
        const user = findUserById(findPost.poster_id);
        return user?.handle || findPost.authorHandle;
    }, [findPost]);

    const handleNavigateToProfile = (handle: string) => {
        router.push(`/profile/${handle}`);
    };

    if (!findPost) {
        return (
            <View className="flex-1 justify-center items-center bg-white dark:bg-black" style={{ paddingTop: insets.top }}>
                
                <Text className="text-neutral-500 dark:text-neutral-400">Could not find the requested post (ID: {postId}).</Text>
            </View>
        );
    }
    return (
        <>

            <ScrollView
                className="flex-1 bg-white dark:bg-black"
                style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
                contentContainerStyle={{ flexGrow: 1 }}
            >
                

                <PostHeader username={authorHandle} />

                <FeedItem
                    itemData={findPost}
                    detailView={true}

                />

                <View className="px-4 mt-2 ">

                    <TouchableOpacity
                        onPress={handlePresentModalPress}
                        className="flex-row items-center mb-3"
                    >
                        <Text className="text-base font-bold text-neutral-500 dark:text-blue-400 mr-1 ">
                            {sortOptions[selectedSort]}
                        </Text>
                        <Feather name="chevron-down" size={18} color={'#536471'} />
                    </TouchableOpacity>

                    <Comments postId={postId} />
                </View>
            </ScrollView>

            <BottomSheetModal
                ref={bottomSheetModalRef}
                index={1}
                snapPoints={snapPoints}
                onChange={handleSheetChanges}
                backdropComponent={props => (
                    <BottomSheetBackdrop
                        {...props}
                        appearsOnIndex={0}
                        disappearsOnIndex={-1}
                    />
                )}
                handleIndicatorStyle={{ backgroundColor: '#EEF3F4', height: 5, width: 35 }}
                backgroundStyle={{
                    backgroundColor: '#ffffff',
                    borderRadius: 30
                }}
            >
                <BottomSheetView style={styles.contentContainer}>
                    <Text className="text-lg font-extrabold text-black dark:text-white  text-center">Sort replies</Text>
                    {Object.entries(sortOptions).map(([key, value]) => (
                        <TouchableOpacity
                            key={key}
                            onPress={() => handleSelectSort(key as SortType)}
                            className="flex-row justify-between items-center py-3 px-4"
                        >
                            <Text className="text-base font-semibold text-black dark:text-white">{value}</Text>
                            {selectedSort === key ? (
                                <View className="w-[22px] h-[22px]  bg-[#1D9BF0] flex items-center justify-center   rounded-full">
                                    <Feather name="check" size={16} color={'white'} />
                                </View>
                            ) : <>
                                <View className="w-[22px] h-[22px]  border-2 border-gray-400   rounded-full"></View>
                            </>}
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