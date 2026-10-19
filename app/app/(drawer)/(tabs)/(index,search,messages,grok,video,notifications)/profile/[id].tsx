import React, { useCallback, useMemo, useState, useReducer, Reducer, useRef, useEffect } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Platform,
  ActivityIndicator,
  ScrollView,
  SectionListData,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  OpacityTransitionView,
  TopNavigationBar,
  ExpandedHeader,
  ScrollingListWithHeader,
} from '~/components/TwitterComponent';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Extrapolate,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedReaction,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { ImageProps } from 'expo-image';
import { useColorScheme } from "nativewind";
import { StyledExpoImage as Image } from "~/components/Image"
import Comment from "~/assets/svg/comment.svg"
import Repost from "~/assets/svg/repost.svg"
import Like from "~/assets/svg/like.svg"
import Save from "~/assets/svg/save.svg"
import Share from "~/assets/svg/share.svg"
import Views from "~/assets/svg/views.svg"
import Category from "~/assets/svg/category.svg"
import Grok from "~/assets/svg/tabs/grok.svg";

import { FeedItem, FeedContent, ProfileImage, PROFILE_IMAGE_SIZE_MAP, findUserById } from '~/components/FeedItem';
import { useLocalSearchParams, useRouter } from 'expo-router';
import users from '~/dummy/users.json';
import sampleFeedItems from '~/dummy/posts.json';
import Messages from "~/assets/svg/tabs/messages.svg"

const PULL_TO_REFRESH_THRESHOLD = 70; 
const PULL_TO_REFRESH_VISIBLE_THRESHOLD = 10; 
const BANNER_BOTTOM_MARGIN = 60; 
const HEADER_PROFILE_IMAGE_SIZE = 'm';
const HEADER_PROFILE_IMAGE_SIZE_VALUE = 100;
const HEADER_PROFILE_IMAGE_START_SCALE = 1;
const HEADER_PROFILE_IMAGE_END_SCALE = 0.6;
const SCREEN_HORIZONTAL_PADDING = 16;

const canUseBlurEffect =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 31);

const APP_PRIMARY_COLOR = '#1d9bf0';

interface User {
  id: string;
  name: string;
  handle: string;
  bio: string;
  url: string;
  followed_by: string;
  items_count: string;
  following_count: number;
  joined_date: string;
  category: string;
  profile_picture: string;
  header_picture: string;
  is_verified: boolean;
  verified_badge: string;
  is_organization: boolean;
}

const ProfileHeader = ({ navBarVisibility, scrollOffset, refreshing, user }: {
  navBarVisibility: any;
  scrollOffset: any;
  refreshing: any;
  user: User;
}) => {
  const navigation = useNavigation();
  const { left: leftInset, right: rightInset, top: safeAreaTop } = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const bannerTotalHeight = useSharedValue(110 + BANNER_BOTTOM_MARGIN);
  const listRef = useRef<any>(null);
  const pullToRefreshThreshold = PULL_TO_REFRESH_THRESHOLD;
  
  const prevScrollOffsetBeforeRefresh = useSharedValue(0);
  
  const isChangingTab = useSharedValue(false);
  const hasReachedThreshold = useSharedValue(false);

  
  const blurOverlayStyle = useAnimatedStyle(() => {
    
    const effectiveScrollOffset = isChangingTab.value ?
      Math.max(50, Math.abs(scrollOffset.value)) :
      Math.abs(scrollOffset.value);

    return {
      opacity: interpolate(
        effectiveScrollOffset,
        [0, 50],
        [0, 1],
        Extrapolate.CLAMP
      ),
    };
  });

  useEffect(() => {
    if (!refreshing) {
      
      
      setTimeout(() => {
        hasReachedThreshold.value = false;
      }, 500); 
    }
  }, [refreshing]);

  useAnimatedReaction(
    () => scrollOffset.value,
    (currentValue, previousValue) => {
      
      if (currentValue >= 0 && !refreshing && hasReachedThreshold.value) {
        
        
        hasReachedThreshold.value = false;
      }
    }
  );

  const profileImageCurrentScale = useDerivedValue(() => interpolate(
    scrollOffset.value,
    [0, BANNER_BOTTOM_MARGIN],
    [HEADER_PROFILE_IMAGE_START_SCALE, HEADER_PROFILE_IMAGE_END_SCALE],
    Extrapolate.CLAMP
  ));

  
  const bannerVerticalShiftStyle = useAnimatedStyle(() => {
    const effectiveScroll = isChangingTab.value ?
      Math.min(0, scrollOffset.value) :
      scrollOffset.value;

    return {
      transform: [{
        translateY: interpolate(
          effectiveScroll,
          [0, BANNER_BOTTOM_MARGIN],
          [0, -BANNER_BOTTOM_MARGIN],
          Extrapolate.CLAMP
        )
      }],
    };
  });

  
  const profileRowVerticalShiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollOffset.value + BANNER_BOTTOM_MARGIN / 2 }],
  }));
  const profileRowZIndexStyle = useAnimatedStyle(() => ({
    zIndex: profileImageCurrentScale.value <= HEADER_PROFILE_IMAGE_END_SCALE ? -1 : 1,
  }));
  const profileImageTransformStyle = useAnimatedStyle(() => {
    const imageTranslateY = interpolate(profileImageCurrentScale.value, [HEADER_PROFILE_IMAGE_START_SCALE, HEADER_PROFILE_IMAGE_END_SCALE], [0, HEADER_PROFILE_IMAGE_SIZE_VALUE / 2.5], Extrapolate.CLAMP);
    return { transform: [{ scale: profileImageCurrentScale.value }, { translateY: imageTranslateY }] };
  });
  const parallaxScaleStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollOffset.value, [0, -(windowHeight + bannerTotalHeight.value)], [1, windowHeight / bannerTotalHeight.value], Extrapolate.CLAMP);
    return { transform: [{ scaleY: scale }, { scaleX: scale }] };
  }, [windowHeight]);

  
  const isNearRefreshThreshold = useDerivedValue(() => {
    return scrollOffset.value < 0 && -scrollOffset.value >= pullToRefreshThreshold * 0.85;
  });

  
  const activityIndicatorStyle = useAnimatedStyle(() => {
    
    
    const showIndicator = refreshing || isNearRefreshThreshold.value;

    
    return {
      opacity: showIndicator ? 1 : 0,
      position: 'absolute',
    };
  });

  
  const arrowStyle = useAnimatedStyle(() => {
    
    if (refreshing || (hasReachedThreshold.value && scrollOffset.value < 0)) {
      return {
        opacity: 0,
        position: 'absolute',
      };
    }

    
    if (scrollOffset.value < 0 && -scrollOffset.value >= pullToRefreshThreshold * 0.85) {
      hasReachedThreshold.value = true;
      return {
        opacity: 0,
        position: 'absolute',
      };
    }

    
    const showArrow = scrollOffset.value < 0 &&
      -scrollOffset.value < pullToRefreshThreshold * 0.85 &&
      !hasReachedThreshold.value;

    return {
      opacity: showArrow ? 1 : 0,
      position: 'absolute',
    };
  });

  
  const handleRefreshStart = useCallback(() => {
    prevScrollOffsetBeforeRefresh.value = scrollOffset.value;
  }, [scrollOffset, prevScrollOffsetBeforeRefresh]);

  
  const handleRefreshEnd = useCallback(() => {
  }, []);

  
  useEffect(() => {
    return () => {
      
      isChangingTab.value = true;
    };
  }, [isChangingTab]);

  
  useEffect(() => {
    isChangingTab.value = false;
  }, [isChangingTab]);

  
  useEffect(() => {
    if (!refreshing && listRef.current && Math.round(scrollOffset.value) < 0) {
      
      listRef.current?.scrollToLocation?.({
        sectionIndex: 0,
        itemIndex: 0,
        viewOffset: 0,
        animated: true,
      });
    }
  }, [refreshing, listRef, scrollOffset]);



  return (
    <View className="relative z-10">
      <Animated.View style={[StyleSheet.absoluteFill, bannerVerticalShiftStyle]}>
        <Animated.View
          onLayout={(e) => (bannerTotalHeight.value = e.nativeEvent.layout.height)}
          style={[parallaxScaleStyle, { minHeight: 110 + BANNER_BOTTOM_MARGIN }]}
        >
          <View style={{ marginBottom: -BANNER_BOTTOM_MARGIN }}>


            {canUseBlurEffect ? (
              <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 1 }, blurOverlayStyle]}>
                <BlurView style={StyleSheet.absoluteFill} intensity={60} tint="dark" />
              </Animated.View>
            ) : (
              <Animated.View
                style={blurOverlayStyle}
                className="absolute inset-0 z-10 bg-black/60"
              />
            )}


            <Image
              source={{ uri: user.header_picture }}
              contentFit="cover"
              contentPosition="center"
              style={[
                { width: windowWidth },
                { height: bannerTotalHeight.value, minHeight: 110 + BANNER_BOTTOM_MARGIN }
              ]}
              className="h-full w-full"
            />



          </View>




        </Animated.View>




        
        <Animated.View
          style={[
            scrollingListStyles.refreshIndicatorContainer,
            { top: safeAreaTop + 20 }
          ]}
        >

          <Animated.View style={arrowStyle}>
            <Feather name="arrow-down" size={24} color="#ffffff" />
          </Animated.View>
          <Animated.View style={activityIndicatorStyle}>
            <ActivityIndicator size="small" color="#ffffff" />
          </Animated.View>

        </Animated.View>




      </Animated.View>








      <TopNavigationBar
        navBarVisibility={navBarVisibility}
        rightContent={
          <View className="flex-row gap-1.5">


            <TouchableOpacity className="bg-black/50 dark:bg-white/20 rounded-full p-2">
              <Grok width={20} height={17} fill="white" />
            </TouchableOpacity>


            <TouchableOpacity className="bg-black/50 dark:bg-white/20 rounded-full p-2">
              <Feather color="white" name="search" size={20} />
            </TouchableOpacity>

            <TouchableOpacity className="bg-black/50 dark:bg-white/20 rounded-full p-2">
              <Share width={20} height={20} fill="white" />
            </TouchableOpacity>


          </View>
        }
        leftContent={
          <View className="flex-row items-center gap-3">
            <TouchableOpacity
              onPress={() => navigation.canGoBack() && navigation.goBack()}
              className="bg-black/50 dark:bg-white/20 rounded-full p-2"
            >
              <Feather color="white" name={'arrow-left'} size={20} />
            </TouchableOpacity>
            <OpacityTransitionView visibilityLevel={navBarVisibility}>
              <Text className="text-lg font-bold text-white">{user.name}</Text>
              <Text className="text-xs text-neutral-300">{user.items_count} posts</Text>
            </OpacityTransitionView>
          </View>
        }
      />


      <Animated.View style={profileRowZIndexStyle} className={` flex  px-${SCREEN_HORIZONTAL_PADDING / 4}`}>
        <Animated.View
          style={[
            { left: Math.max(leftInset, SCREEN_HORIZONTAL_PADDING), right: Math.max(rightInset, SCREEN_HORIZONTAL_PADDING) },
            profileRowVerticalShiftStyle,
            { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
          ]}
          className="absolute flex-row justify-between items-end "
        >
          <Animated.View style={profileImageTransformStyle}>
            <TouchableOpacity>
              <ProfileImage
                displaySize={HEADER_PROFILE_IMAGE_SIZE}
                source={{ uri: user.profile_picture }}
                style={{
                  padding: 10,
                  backgroundColor: 'white'
                }}
              />
            </TouchableOpacity>
          </Animated.View>
          {user.id === '1' || user.id === '2' ? (
            <TouchableOpacity className="absolute bottom-0 right-0 py-1 px-3 bg-transparent rounded-full border border-neutral-400/50 dark:border-neutral-600/50 flex flex-start  ">
              <Text className="text-base font-bold text-black dark:text-white">Edit Profile</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity className="absolute bottom-0 right-0 py-1 px-8 bg-black rounded-full border border-neutral-400/50 dark:border-neutral-600/50 flex flex-start  ">
              <Text className="text-base font-bold text-white">Follow</Text>
            </TouchableOpacity>

          )}

        </Animated.View>
      </Animated.View>
    </View>
  );
};

const ProfileDetailsHeader = ({ user }: { user: User }) => {
  const { top: topInset } = useSafeAreaInsets();

  const handleLinkPress = useCallback(async (url: string) => {
    const formattedUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    try {
      const isSupported = await Linking.canOpenURL(formattedUrl);
      if (isSupported) {
        await Linking.openURL(formattedUrl);
      } else {
        console.warn(`Cannot open URL: ${formattedUrl}`);
      }
    } catch (error) {
      console.error("Error opening link:", error);
    }
  }, []);

  return (
    <ExpandedHeader>
      <View
        style={{ marginTop: topInset - 10 + HEADER_PROFILE_IMAGE_SIZE_VALUE / 2 }}
        className={`flex-col gap-2 px-${SCREEN_HORIZONTAL_PADDING / 3} w-full`}
      >
        <View className="flex-row gap-2 items-center">
          <Text className="text-2xl font-extrabold text-black dark:text-white">{user.name}</Text>
          {user.is_verified && (
            <Image
              source={{ uri: user.verified_badge }}
              style={{ width: 16, height: 16, alignItems: 'center' }}
            />
          )}
        </View>
        <Text className="text-neutral-500 dark:text-neutral-400 text-base -mt-3">@{user.handle}</Text>
        <Text className="text-black dark:text-white text-lg leading-relaxed">
          {user.bio}
        </Text>
        <View className="flex-row gap-2 items-center flex-wrap">
          <View className="flex-row gap-1.5 items-center">
            <Category width={16} height={16} opacity={0.5} />
            <Text className="text-neutral-500 dark:text-neutral-400 text-base">{user.category}</Text>
          </View>
          <View className="flex-row gap-1.5 items-center">
            <Feather name="link" color="rgb(163 163 163)" size={14} />
            <Text onPress={() => handleLinkPress(user.url)} className="text-sky-500 dark:text-sky-400 text-base">
              {user.url}
            </Text>
          </View>
        </View>
        <View className="flex-row gap-1.5 items-center">
          <Feather name="calendar" color="rgb(163 163 163)" size={14} />
          <Text className="text-neutral-500 dark:text-neutral-400 text-base">Joined {user.joined_date}</Text>
        </View>
        <View className="flex-row gap-4 items-center">
          <TouchableOpacity className="flex-row gap-1.5 items-center">
            <Text className="text-black dark:text-white text-base font-semibold">{user.following_count}</Text>
            <Text className="text-neutral-500 dark:text-neutral-400 text-base">Following</Text>
          </TouchableOpacity>
          <TouchableOpacity className="flex-row gap-1.5 items-center">
            <Text className="text-black dark:text-white text-base font-semibold">{user.followed_by}</Text>
            <Text className="text-neutral-500 dark:text-neutral-400 text-base">Followers</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row gap-8 items-center">
          <View className="relative flex-row" style={{ width: PROFILE_IMAGE_SIZE_MAP.xs + (PROFILE_IMAGE_SIZE_MAP.xs / 1.8) * 2, height: PROFILE_IMAGE_SIZE_MAP.xs + 6 }}>
            {[10, 20, 30].map((imgNum, index) => (
              <ProfileImage
                key={`follower-${imgNum}`}
                displaySize="xs"
                source={{
                  uri: index === 0 ? "https://pbs.twimg.com/profile_images/1676741952014897152/j5t0mY_I_400x400.jpg" :
                    index === 1 ? "https://pbs.twimg.com/profile_images/1785867863191932928/EpOqfO6d_400x400.png" :
                      "https://pbs.twimg.com/profile_images/1776070739319214080/TBARcp9C_400x400.jpg"
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  zIndex: 3 - index,
                  left: (PROFILE_IMAGE_SIZE_MAP.xs / 1.8) * index,
                  borderRadius: 100,
                }}
                className="border-2 border-white dark:border-black"
              />
            ))}
          </View>
          <Text className="text-neutral-500 dark:text-neutral-400 text-sm flex-1 -ml-2">
            Followed by Expo, React Native, and 15 others
          </Text>
        </View>
      </View>
    </ExpandedHeader>
  );
};

export default function UserProfileScreen() {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<any>(null);
  const { colorScheme, setColorScheme } = useColorScheme();
  const scrollPosition = useSharedValue(0);
  const router = useRouter();

  
  const params = useLocalSearchParams();
  const userHandle = params.id as string;

  
  const user = useMemo(() => {
    return users.find((user) => user.handle.toLowerCase() === userHandle.toLowerCase()) || users[0];
  }, [userHandle]);

  
  const userPosts = useMemo(() => {
    
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

    
    return processedFeedItems
      .filter(post => post.poster_id === user.id)
      .sort((a, b) => {
        const timeA = typeof a.posted_time === 'number' ? a.posted_time : parseInt(String(a.posted_time), 10);
        const timeB = typeof b.posted_time === 'number' ? b.posted_time : parseInt(String(b.posted_time), 10);
        return timeB - timeA; 
      });
  }, [user.id]);

  const feedSections: SectionListData<FeedContent, { title: string }>[] = useMemo(() => [
    {
      title: 'Feed',
      data: userPosts.length > 0 ? userPosts : [
        
        {
          contentId: 'post-empty',
          poster_id: user.id,
          authorName: user.name,
          authorHandle: user.handle,
          authorImageUrl: user.profile_picture,
          posted_time: Date.now(),
          message: 'No posts yet',
          like_count: 0,
          retweet_count: 0,
          reply_count: 0,
          view_count: '0'
        }
      ]
    },
  ], [user, userPosts]);

  const profileTabs = ['Posts', 'Affiliates', 'Replies', 'Highlights', 'Videos', 'Photos', 'Articles'];

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
    }, 2000);
  }, []);

  const handleItemPress = (postId: string) => {
    router.push(`/post/${postId}`);
  };

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollPosition.value = event.contentOffset.y;
    },
  });

  return (
    <>
      <StatusBar style="light" />
      <ScrollingListWithHeader
        NavigationBarComponent={(props) => <ProfileHeader {...props} user={user} refreshing={refreshing} />}

        ExpandedHeaderComponent={(props) => <ProfileDetailsHeader {...props} user={user} />}
        sections={feedSections}
        ignoreLeftPadding
        ignoreRightPadding
        expandedHeaderCollapseThreshold={0.25}
        style={{ flex: 1, backgroundColor: 'white' }}

        contentContainerStyle={{ paddingBottom: bottomInset, flexGrow: 1, backgroundColor: colorScheme === 'light' ? 'white' : 'black' }}
        renderItem={({ item }: { item: FeedContent }) => <FeedItem itemData={item} onPress={() => handleItemPress(item.contentId || '')} />}
        stickySectionHeadersEnabled
        renderSectionHeader={() => (
          <View className=" border-b border-neutral-200 dark:border-neutral-700">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SCREEN_HORIZONTAL_PADDING / 4 }}
              contentContainerClassName="flex-row items-center bg-white dark:bg-black w-full"
            >
              {profileTabs.map((tabName, index) => (
                <TouchableOpacity
                  key={`tab-${index}`}
                  className="px-4 justify-center items-center h-[46px] relative"
                  onPress={() => setSelectedTabIndex(index)}
                >
                  <Text className={`text-[16px] font-bold ${selectedTabIndex === index ? 'text-black dark:text-white' : 'text-neutral-500 dark:text-neutral-400'}`}>
                    {tabName}
                  </Text>
                  {selectedTabIndex === index && (
                    <View
                      className="h-1 w-4/5 rounded absolute bottom-0"
                      style={{ backgroundColor: APP_PRIMARY_COLOR }}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            progressViewOffset={100} 
          />
        }
        ref={listRef}
      />
    </>
  );
};

const scrollingListStyles = StyleSheet.create({
  outerWrapper: { flex: 1 },
  refreshIndicatorContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    left: '50%',
    marginLeft: -20,
    zIndex: 10,
  },
});