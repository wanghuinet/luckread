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

import { FeedItem, FeedContent, ProfileImage, PROFILE_IMAGE_SIZE_MAP } from '~/components/FeedItem';
import FollowButton from '~/components/FollowButton';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiRequest, getApiErrorMessage } from '~/lib/api-client';
import { mapContentToFeedContent, readContentBody, readContentSocial, readContentAuthor, resolveNativeMediaSource, resolvePublicProfileById, unwrapApiData, type ApiContentPage, type ApiContentRecord } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';
import { readSessionToken } from '~/lib/secure-session';
import { fetchUserLikedContentsPage, fetchUserRepliesPage } from '~/lib/social-screen-api';
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

type ProfileLikedContentPage = {
  items: Array<{ contentId: string; likedAt: string }>;
  nextCursor?: string | null;
  hasMore?: boolean;
};

type ProfileReplyRecord = {
  id: string;
  contentId: string;
  authorUserId: string;
  parentId: string | null;
  body: string;
  state: 'PUBLISHED';
  depth: number;
  createdAt: string;
  updatedAt: string;
};

type ProfileReplyPage = {
  items: ProfileReplyRecord[];
  nextCursor?: string | null;
  hasMore?: boolean;
};

type ProfileReplyDisplay = FeedContent & {
  profileReply?: Pick<ProfileReplyRecord, 'id' | 'authorUserId' | 'parentId' | 'body' | 'createdAt' | 'depth'>;
};

interface User {
  id: string;
  name: string;
  handle: string;
  bio: string;
  url: string;
  followed_by: string;
  items_count: string;
  following_count?: number;
  joined_date: string;
  category: string;
  profile_picture: string;
  profile_picture_headers?: Record<string, string>;
  header_picture: string;
  header_picture_headers?: Record<string, string>;
  is_verified: boolean;
  verified_badge: string;
  is_organization: boolean;
}

const ProfileHeader = ({ navBarVisibility, scrollOffset, refreshing, user, currentUserId }: {
  navBarVisibility: any;
  scrollOffset: any;
  refreshing: any;
  user: User;
  currentUserId: string | null;
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
              source={user.header_picture ? { uri: user.header_picture, headers: user.header_picture_headers } : undefined}
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
                source={{ uri: user.profile_picture, headers: user.profile_picture_headers }}
                style={{
                  padding: 10,
                  backgroundColor: 'white'
                }}
              />
            </TouchableOpacity>
          </Animated.View>
          {user.id !== currentUserId ? (
            <View className="absolute bottom-0 right-0">
              <FollowButton targetUsername={user.handle} />
            </View>
          ) : null}

        </Animated.View>
      </Animated.View>
    </View>
  );
};

const ProfileDetailsHeader = ({ user }: { user: User }) => {
  const { top: topInset } = useSafeAreaInsets();
  const router = useRouter();

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
        {(user.category || user.url) ? (
          <View className="flex-row gap-2 items-center flex-wrap">
            {user.category ? (
              <View className="flex-row gap-1.5 items-center">
                <Category width={16} height={16} opacity={0.5} />
                <Text className="text-neutral-500 dark:text-neutral-400 text-base">{user.category}</Text>
              </View>
            ) : null}
            {user.url ? (
              <View className="flex-row gap-1.5 items-center">
                <Feather name="link" color="rgb(163 163 163)" size={14} />
                <Text onPress={() => handleLinkPress(user.url)} className="text-sky-500 dark:text-sky-400 text-base">
                  {user.url}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {user.joined_date ? (
          <View className="flex-row gap-1.5 items-center">
            <Feather name="calendar" color="rgb(163 163 163)" size={14} />
            <Text className="text-neutral-500 dark:text-neutral-400 text-base">Joined {user.joined_date}</Text>
          </View>
        ) : null}
        {(typeof user.following_count === 'number' || user.followed_by) ? (
          <View className="flex-row gap-4 items-center">
            {typeof user.following_count === 'number' ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => router.push(('/profile/relationships/' + encodeURIComponent(user.id) + '?type=following') as never)}
                className="flex-row gap-1.5 items-center"
              >
                <Text className="text-black dark:text-white text-base font-semibold">{user.following_count}</Text>
                <Text className="text-neutral-500 dark:text-neutral-400 text-base">Following</Text>
              </TouchableOpacity>
            ) : null}
            {user.followed_by ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => router.push(('/profile/relationships/' + encodeURIComponent(user.id) + '?type=followers') as never)}
                className="flex-row gap-1.5 items-center"
              >
                <Text className="text-black dark:text-white text-base font-semibold">{user.followed_by}</Text>
                <Text className="text-neutral-500 dark:text-neutral-400 text-base">Followers</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
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
  const rawUserHandle = params.id;
  const userHandle = (Array.isArray(rawUserHandle) ? rawUserHandle[0] : rawUserHandle || '').replace(/^@/, '');
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const [user, setUser] = useState<User | null>(null);
  const [userPosts, setUserPosts] = useState<FeedContent[]>([]);
  const [likedPosts, setLikedPosts] = useState<FeedContent[]>([]);
  const [likesCursor, setLikesCursor] = useState<string | null>(null);
  const [likesHasMore, setLikesHasMore] = useState(false);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likesLoadingMore, setLikesLoadingMore] = useState(false);
  const [likesError, setLikesError] = useState('');
  const [likesLoadedForUserId, setLikesLoadedForUserId] = useState<string | null>(null);
  const [profileReplies, setProfileReplies] = useState<ProfileReplyDisplay[]>([]);
  const [repliesCursor, setRepliesCursor] = useState<string | null>(null);
  const [repliesHasMore, setRepliesHasMore] = useState(false);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [repliesLoadingMore, setRepliesLoadingMore] = useState(false);
  const [repliesError, setRepliesError] = useState('');
  const [repliesLoadedForUserId, setRepliesLoadedForUserId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [feedError, setFeedError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const likesRequestRef = useRef<AbortController | null>(null);
  const repliesRequestRef = useRef<AbortController | null>(null);

  const loadProfile = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setProfileLoading(true);
    setRefreshing(true);
    setProfileError('');
    setFeedError('');

    try {
      const profilePath = '/users/by-username/' + encodeURIComponent(userHandle);
      let profileResult = await apiRequest<{
        id?: string; username?: string; displayName?: string | null; bio?: string | null; avatar?: string | null;
        website?: string | null; category?: string | null; createdAt?: string; followerCount?: number; followingCount?: number;
        coverImage?: string | null; headerImage?: string | null; isVerified?: boolean; verifiedBadge?: string | null;
        isOrganization?: boolean; error?: { message?: string };
      }>(profilePath, { method: 'GET', signal: controller.signal });
      let profile = profileResult.response.ok ? unwrapApiData<{
        id?: string; username?: string; displayName?: string | null; bio?: string | null; avatar?: string | null;
        website?: string | null; category?: string | null; createdAt?: string; followerCount?: number; followingCount?: number;
        coverImage?: string | null; headerImage?: string | null; isVerified?: boolean; verifiedBadge?: string | null;
        isOrganization?: boolean;
      }>(profileResult.data) : null;

      if (!profile?.id) {
        // The public profile ID and Better Auth identity ID can differ. Reuse
        // the existing identity mapping instead of inventing a profile.
        profile = await resolvePublicProfileById(userHandle, controller.signal);
      }
      if (!profile?.id) {
        throw new Error(getApiErrorMessage(profileResult.data, 'Could not load this profile.', profileResult.response.status));
      }
      if (controller.signal.aborted) return;

      const sessionToken = await readSessionToken().catch(() => null);
      if (controller.signal.aborted) return;

      let posts: FeedContent[] = [];
      let hasMorePosts = false;
      const pinResultPromise = apiRequest<unknown>(
        '/users/' + encodeURIComponent(profile.id) + '/pinned-content',
        { method: 'GET', auth: false, signal: controller.signal },
      ).catch(() => null);
      const contentParams = new URLSearchParams({ creatorId: profile.id, type: 'post', limit: '20' });
      const feedResult = await apiRequest<{ data?: ApiContentPage; error?: { message?: string } }>(
        '/contents?' + contentParams.toString(),
        { method: 'GET', signal: controller.signal },
      );
      const page = feedResult.response.ok ? unwrapApiData<ApiContentPage>(feedResult.data) : null;
      if (!feedResult.response.ok || !page || !Array.isArray(page.items)) {
        setFeedError(getApiErrorMessage(feedResult.data, 'Could not load posts from this profile.'));
      } else {
        hasMorePosts = page.hasMore === true;
        posts = await Promise.all(
          page.items
            .filter((item): item is ApiContentRecord => Boolean(item && typeof item.id === 'string'))
            .map(async (item) => {
              const [body, social, author] = await Promise.all([
                readContentBody(item, controller.signal, sessionToken),
                readContentSocial(item.id, controller.signal),
                readContentAuthor(item),
              ]);
              return mapContentToFeedContent(item, body, social, author, sessionToken);
            }),
        );
      }
      if (controller.signal.aborted) return;

      // The pin is a reference to canonical W03 content; never copy body/media into W05.
      const pinResult = await pinResultPromise;
      const pinRecord = pinResult?.response.ok
        ? unwrapApiData<{ contentId?: string } | null>(pinResult.data)
        : null;
      const pinnedContentId = typeof pinRecord?.contentId === 'string' && pinRecord.contentId.trim()
        ? pinRecord.contentId.trim()
        : null;
      let pinnedPost = pinnedContentId
        ? posts.find((post) => post.contentId === pinnedContentId) ?? null
        : null;

      // A pin may be older than the latest content page. Load only that referenced
      // post so it remains visible at the top of its owner's profile.
      if (pinnedContentId && !pinnedPost) {
        try {
          const pinnedResult = await apiRequest<unknown>(
            '/contents/' + encodeURIComponent(pinnedContentId),
            { method: 'GET', signal: controller.signal },
          );
          const pinnedRecord = pinnedResult.response.ok
            ? unwrapApiData<ApiContentRecord>(pinnedResult.data)
            : null;
          const ownerMatches = pinnedRecord && (
            pinnedRecord.ownerUserId === profile.id ||
            pinnedRecord.creatorId === profile.id
          );
          if (
            pinnedRecord?.id === pinnedContentId &&
            ownerMatches &&
            (!pinnedRecord.contentType || pinnedRecord.contentType === 'post') &&
            (!pinnedRecord.state || pinnedRecord.state === 'PUBLISHED')
          ) {
            const [body, social, author] = await Promise.all([
              readContentBody(pinnedRecord, controller.signal, sessionToken),
              readContentSocial(pinnedRecord.id, controller.signal),
              readContentAuthor(pinnedRecord),
            ]);
            pinnedPost = mapContentToFeedContent(
              pinnedRecord,
              body,
              social,
              author,
              sessionToken,
            );
            posts = [pinnedPost, ...posts];
          }
        } catch {
          // Failure to resolve an old pin must not break the rest of the public profile.
        }
      }
      const postCountBeforePinDecoration = posts.length;
      if (pinnedPost) {
        posts = [
          { ...pinnedPost, isProfilePinned: true },
          ...posts.filter((post) => post.contentId !== pinnedContentId),
        ];
      }

      if (controller.signal.aborted) return;

      const [followersResult, followingResult] = await Promise.all([
        apiRequest<unknown>(
          '/users/' + encodeURIComponent(profile.id) + '/followers?limit=1',
          { method: 'GET', signal: controller.signal },
        ).catch(() => null),
        apiRequest<unknown>(
          '/users/' + encodeURIComponent(profile.id) + '/following?limit=1',
          { method: 'GET', signal: controller.signal },
        ).catch(() => null),
      ]);
      const followersPage = followersResult?.response.ok
        ? unwrapApiData<{ totalCount?: number }>(followersResult.data)
        : null;
      const followingPage = followingResult?.response.ok
        ? unwrapApiData<{ totalCount?: number }>(followingResult.data)
        : null;
      if (controller.signal.aborted) return;

      const profileAvatarSource = resolveNativeMediaSource(profile.avatar, sessionToken);
      const profileHeaderSource = resolveNativeMediaSource(profile.headerImage || profile.coverImage, sessionToken);

      setUser({
        id: profile.id,
        name: profile.displayName?.trim() || profile.username || 'LuckRead member',
        handle: profile.username || userHandle || profile.id,
        bio: profile.bio || '',
        url: profile.website || '',
        followed_by: typeof followersPage?.totalCount === 'number'
          ? String(followersPage.totalCount)
          : typeof profile.followerCount === 'number' ? String(profile.followerCount) : '',
        following_count: typeof followingPage?.totalCount === 'number'
          ? followingPage.totalCount
          : typeof profile.followingCount === 'number' ? profile.followingCount : undefined,
        items_count: hasMorePosts ? String(postCountBeforePinDecoration) + '+' : String(postCountBeforePinDecoration),
        joined_date: profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '',
        category: profile.category || '',
        profile_picture: profileAvatarSource?.uri || '',
        profile_picture_headers: profileAvatarSource?.headers,
        header_picture: profileHeaderSource?.uri || '',
        header_picture_headers: profileHeaderSource?.headers,
        is_verified: profile.isVerified === true,
        verified_badge: profile.verifiedBadge || '',
        is_organization: profile.isOrganization === true,
      });
      setUserPosts(posts);
    } catch (error) {
      if (controller.signal.aborted) return;
      setProfileError(error instanceof Error ? error.message : 'Could not load this profile.');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setProfileLoading(false);
        setRefreshing(false);
      }
    }
  }, [userHandle]);

  useEffect(() => {
    void loadProfile();
    return () => {
      requestRef.current?.abort();
      likesRequestRef.current?.abort();
      repliesRequestRef.current?.abort();
    };
  }, [loadProfile]);

  useEffect(() => {
    setSelectedTabIndex(0);
    setRefreshing(false);
    setLikesError('');
    setLikesLoading(false);
    setLikesLoadingMore(false);
    setLikesLoadedForUserId(null);
    setLikedPosts([]);
    setLikesCursor(null);
    setLikesHasMore(false);
    likesRequestRef.current?.abort();
    setProfileReplies([]);
    setRepliesCursor(null);
    setRepliesHasMore(false);
    setRepliesError('');
    setRepliesLoading(false);
    setRepliesLoadingMore(false);
    setRepliesLoadedForUserId(null);
    repliesRequestRef.current?.abort();
  }, [userHandle]);

  const loadLikedPosts = useCallback(async (
    profileUserId: string,
    nextCursor: string | null,
    append: boolean,
    showRefreshIndicator = false,
  ) => {
    if (!currentUserId || profileUserId !== currentUserId) {
      setLikesError('Sign in to view your Likes.');
      return;
    }

    likesRequestRef.current?.abort();
    const controller = new AbortController();
    likesRequestRef.current = controller;
    if (append) setLikesLoadingMore(true);
    else {
      setLikesLoading(true);
      setLikedPosts([]);
      setLikesCursor(null);
      setLikesHasMore(false);
    }
    setLikesError('');
    if (showRefreshIndicator) setRefreshing(true);

    try {
      const result = await fetchUserLikedContentsPage(profileUserId, {
        cursor: nextCursor,
        limit: 20,
        signal: controller.signal,
      });
      const page = result.response.ok
        ? unwrapApiData<ProfileLikedContentPage>(result.data)
        : null;
      if (!result.response.ok || !page || !Array.isArray(page.items)) {
        throw new Error(getApiErrorMessage(result.data, 'Could not load liked posts. Please retry.', result.response.status));
      }

      const sessionToken = await readSessionToken().catch(() => null);
      if (controller.signal.aborted) return;
      const mappedItems = await Promise.all(page.items.map(async (likedItem): Promise<FeedContent | null> => {
        const contentId = typeof likedItem?.contentId === 'string' ? likedItem.contentId.trim() : '';
        if (!contentId) return null;

        const contentResult = await apiRequest<unknown>(
          '/contents/' + encodeURIComponent(likedItem.contentId),
          { method: 'GET', signal: controller.signal },
        );
        if (!contentResult.response.ok) {
          if ([403, 404, 410].includes(contentResult.response.status)) return null;
          throw new Error(getApiErrorMessage(contentResult.data, 'Could not load a liked post. Please retry.', contentResult.response.status));
        }
        const record = unwrapApiData<ApiContentRecord>(contentResult.data);
        if (
          !record ||
          record.id !== contentId ||
          (record.state && record.state !== 'PUBLISHED')
        ) return null;

        const [body, social, author] = await Promise.all([
          readContentBody(record, controller.signal, sessionToken),
          readContentSocial(record.id, controller.signal),
          readContentAuthor(record),
        ]);
        return mapContentToFeedContent(record, body, social, author, sessionToken);
      }));

      if (controller.signal.aborted || profileUserId !== currentUserId) return;
      const mapped = mappedItems.filter((item): item is FeedContent => item !== null);
      setLikedPosts((current) => {
        if (!append) return mapped;
        const known = new Set(current.map((item) => item.contentId));
        return [...current, ...mapped.filter((item) => item.contentId && !known.has(item.contentId))];
      });
      setLikesCursor(page.nextCursor || null);
      setLikesHasMore(page.hasMore === true);
      setLikesLoadedForUserId(profileUserId);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setLikesError(cause instanceof Error ? cause.message : 'Could not load liked posts. Please retry.');
    } finally {
      if (likesRequestRef.current === controller) likesRequestRef.current = null;
      if (!controller.signal.aborted) {
        setLikesLoading(false);
        setLikesLoadingMore(false);
        if (showRefreshIndicator) setRefreshing(false);
      }
    }
  }, [currentUserId]);

  const loadProfileReplies = useCallback(async (
    profileUserId: string,
    nextCursor: string | null,
    append: boolean,
    showRefreshIndicator = false,
  ) => {
    repliesRequestRef.current?.abort();
    const controller = new AbortController();
    repliesRequestRef.current = controller;
    if (append) setRepliesLoadingMore(true);
    else {
      setRepliesLoading(true);
      setProfileReplies([]);
      setRepliesCursor(null);
      setRepliesHasMore(false);
    }
    setRepliesError('');
    if (showRefreshIndicator) setRefreshing(true);

    try {
      const result = await fetchUserRepliesPage(profileUserId, {
        cursor: nextCursor,
        limit: 20,
        signal: controller.signal,
      });
      const page = result.response.ok ? unwrapApiData<ProfileReplyPage>(result.data) : null;
      if (
        !result.response.ok ||
        !page ||
        !Array.isArray(page.items) ||
        typeof page.hasMore !== 'boolean' ||
        (page.nextCursor !== null && typeof page.nextCursor !== 'string')
      ) {
        throw new Error(getApiErrorMessage(
          result.data,
          'Could not load replies. Please retry.',
          result.response.status,
        ));
      }

      const sessionToken = await readSessionToken().catch(() => null);
      if (controller.signal.aborted) return;
      const mappedItems = await Promise.all(page.items.map(async (reply): Promise<ProfileReplyDisplay | null> => {
        const replyId = typeof reply?.id === 'string' ? reply.id.trim() : '';
        const contentId = typeof reply?.contentId === 'string' ? reply.contentId.trim() : '';
        const body = typeof reply?.body === 'string' ? reply.body.trim() : '';
        if (!replyId || !contentId || !body) return null;

        const contentResult = await apiRequest<unknown>(
          '/contents/' + encodeURIComponent(contentId),
          { method: 'GET', signal: controller.signal },
        );
        if (!contentResult.response.ok) {
          if ([403, 404, 410].includes(contentResult.response.status)) return null;
          throw new Error(getApiErrorMessage(
            contentResult.data,
            'Could not load the original post for a reply. Please retry.',
            contentResult.response.status,
          ));
        }
        const record = unwrapApiData<ApiContentRecord>(contentResult.data);
        if (!record || record.id !== contentId || (record.state && record.state !== 'PUBLISHED')) return null;

        const [parentBody, social, author] = await Promise.all([
          readContentBody(record, controller.signal, sessionToken),
          readContentSocial(record.id, controller.signal),
          readContentAuthor(record),
        ]);
        const parentPost = mapContentToFeedContent(record, parentBody, social, author, sessionToken);
        return {
          ...parentPost,
          profileReply: {
            id: replyId,
            authorUserId: reply.authorUserId,
            parentId: reply.parentId,
            body,
            createdAt: reply.createdAt,
            depth: reply.depth,
          },
        };
      }));

      if (controller.signal.aborted) return;
      const mapped = mappedItems.filter((item): item is ProfileReplyDisplay => item !== null);
      setProfileReplies((current) => {
        if (!append) return mapped;
        const known = new Set(current.map((item) => item.profileReply?.id));
        return [...current, ...mapped.filter((item) => item.profileReply && !known.has(item.profileReply.id))];
      });
      setRepliesCursor(page.nextCursor || null);
      setRepliesHasMore(page.hasMore);
      setRepliesLoadedForUserId(profileUserId);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setRepliesError(cause instanceof Error ? cause.message : 'Could not load replies. Please retry.');
      }
    } finally {
      if (repliesRequestRef.current === controller) repliesRequestRef.current = null;
      if (!controller.signal.aborted) {
        setRepliesLoading(false);
        setRepliesLoadingMore(false);
        if (showRefreshIndicator) setRefreshing(false);
      }
    }
  }, []);

  const isOwnProfile = Boolean(user?.id && currentUserId && user.id === currentUserId);
  const showingReplies = selectedTabIndex === 1;
  const showingLikes = isOwnProfile && selectedTabIndex === 2;

  useEffect(() => {
    if (!isOwnProfile && selectedTabIndex > 1) setSelectedTabIndex(0);
  }, [isOwnProfile, selectedTabIndex]);
  const profileTabs = isOwnProfile ? ['Posts', 'Replies', 'Likes'] : ['Posts', 'Replies'];

  useEffect(() => {
    if (
      showingReplies &&
      user?.id &&
      repliesLoadedForUserId !== user.id &&
      !repliesLoading &&
      !repliesError
    ) {
      void loadProfileReplies(user.id, null, false);
    }
  }, [showingReplies, user?.id, repliesLoadedForUserId, repliesLoading, repliesError, loadProfileReplies]);

  useEffect(() => {
    if (
      showingLikes &&
      user?.id &&
      likesLoadedForUserId !== user.id &&
      !likesLoading &&
      !likesError
    ) {
      void loadLikedPosts(user.id, null, false);
    }
  }, [showingLikes, user?.id, likesLoadedForUserId, likesLoading, likesError, loadLikedPosts]);

  const displayedPosts: FeedContent[] = showingReplies
    ? profileReplies
    : showingLikes ? likedPosts : userPosts;
  const feedSections: SectionListData<FeedContent, { title: string }>[] = useMemo(() => [
    { title: showingReplies ? 'Replies' : showingLikes ? 'Likes' : 'Feed', data: displayedPosts },
  ], [displayedPosts, showingLikes, showingReplies]);

  const handleRefresh = useCallback(() => {
    if (showingReplies && user?.id) {
      void loadProfileReplies(user.id, null, false, true);
      return;
    }
    if (showingLikes && user?.id) {
      void loadLikedPosts(user.id, null, false, true);
      return;
    }
    void loadProfile();
  }, [loadLikedPosts, loadProfile, loadProfileReplies, showingLikes, showingReplies, user?.id]);

  const handleItemPress = (postId: string) => {
    router.push(`/post/${postId}`);
  };

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollPosition.value = event.contentOffset.y;
    },
  });


  if (profileLoading && !user) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator size="large" color={APP_PRIMARY_COLOR} />
        <Text className="mt-3 text-sm text-neutral-500">Loading profile…</Text>
      </View>
    );
  }

  if (profileError || !user) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black px-6">
        <Text className="text-center text-base text-neutral-500">{profileError || 'Profile not found.'}</Text>
        <TouchableOpacity accessibilityRole="button" className="mt-4 rounded-full bg-sky-500 px-5 py-3" onPress={() => void loadProfile()}>
          <Text className="font-bold text-white">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <ScrollingListWithHeader
        NavigationBarComponent={(props) => <ProfileHeader {...props} user={user} refreshing={refreshing} currentUserId={currentUserId} />}

        ExpandedHeaderComponent={(props) => <ProfileDetailsHeader {...props} user={user} />}
        sections={feedSections}
        ListEmptyComponent={(
          <View className="items-center px-6 py-12">
            {showingReplies && repliesLoading ? (
              <>
                <ActivityIndicator color={APP_PRIMARY_COLOR} />
                <Text className="mt-3 text-center text-sm text-neutral-500">Loading replies…</Text>
              </>
            ) : showingReplies && repliesError ? (
              <>
                <Text className="text-center text-sm text-neutral-500">{repliesError}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  className="mt-3 rounded-full bg-sky-500 px-4 py-2"
                  onPress={() => user?.id && void loadProfileReplies(user.id, null, false)}
                >
                  <Text className="font-bold text-white">Retry</Text>
                </TouchableOpacity>
              </>
            ) : showingLikes && likesLoading ? (
              <>
                <ActivityIndicator color={APP_PRIMARY_COLOR} />
                <Text className="mt-3 text-center text-sm text-neutral-500">Loading liked posts…</Text>
              </>
            ) : showingLikes && likesError ? (
              <>
                <Text className="text-center text-sm text-neutral-500">{likesError}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  className="mt-3 rounded-full bg-sky-500 px-4 py-2"
                  onPress={() => user?.id && void loadLikedPosts(user.id, null, false)}
                >
                  <Text className="font-bold text-white">Retry</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text className="text-center text-sm text-neutral-500">
                {showingReplies ? 'No public replies yet.' : showingLikes ? 'No liked posts yet.' : feedError || 'No public posts yet.'}
              </Text>
            )}
          </View>
        )}
        ignoreLeftPadding
        ignoreRightPadding
        expandedHeaderCollapseThreshold={0.25}
        style={{ flex: 1, backgroundColor: 'white' }}

        contentContainerStyle={{ paddingBottom: bottomInset, flexGrow: 1, backgroundColor: colorScheme === 'light' ? 'white' : 'black' }}
        keyExtractor={(item: FeedContent, index: number) => {
          const reply = (item as ProfileReplyDisplay).profileReply;
          return reply?.id ? 'profile-reply:' + reply.id : item.contentId || 'profile-post:' + index;
        }}
        renderItem={({ item }: { item: FeedContent }) => {
          const reply = (item as ProfileReplyDisplay).profileReply;
          return (
            <View>
              {reply ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="打开回复对应的原帖"
                  onPress={() => handleItemPress(item.contentId || '')}
                  className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800"
                  activeOpacity={0.75}
                >
                  <View className="mb-2 flex-row items-center gap-2">
                    <Feather name="message-circle" size={15} color="#6b7280" />
                    <Text className="text-sm text-neutral-500">
                      Replying to @{item.authorHandle || 'author'}
                    </Text>
                  </View>
                  <Text className="text-base leading-6 text-neutral-900 dark:text-neutral-100">{reply.body}</Text>
                </TouchableOpacity>
              ) : null}
              <FeedItem itemData={item} onPress={() => handleItemPress(item.contentId || '')} />
            </View>
          );
        }}
        ListFooterComponent={showingReplies && repliesHasMore && repliesCursor ? (
          <View className="items-center px-4 py-4">
            {repliesError ? (
              <>
                <Text className="mb-3 text-center text-sm text-rose-600">{repliesError}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={repliesLoadingMore}
                  className="rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700"
                  onPress={() => user?.id && void loadProfileReplies(user.id, repliesCursor, true)}
                >
                  <Text className="font-bold text-sky-600">Retry loading replies</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={repliesLoadingMore}
                className="rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700"
                onPress={() => user?.id && void loadProfileReplies(user.id, repliesCursor, true)}
              >
                {repliesLoadingMore ? (
                  <ActivityIndicator color={APP_PRIMARY_COLOR} />
                ) : (
                  <Text className="font-bold text-sky-600">Load more replies</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : showingLikes && likesHasMore && likesCursor ? (
          <View className="items-center px-4 py-4">
            {likesError ? (
              <>
                <Text className="mb-3 text-center text-sm text-rose-600">{likesError}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={likesLoadingMore}
                  className="rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700"
                  onPress={() => user?.id && void loadLikedPosts(user.id, likesCursor, true)}
                >
                  <Text className="font-bold text-sky-600">Retry loading likes</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={likesLoadingMore}
                className="rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700"
                onPress={() => user?.id && void loadLikedPosts(user.id, likesCursor, true)}
              >
                {likesLoadingMore ? (
                  <ActivityIndicator color={APP_PRIMARY_COLOR} />
                ) : (
                  <Text className="font-bold text-sky-600">Load more liked posts</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : null}
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