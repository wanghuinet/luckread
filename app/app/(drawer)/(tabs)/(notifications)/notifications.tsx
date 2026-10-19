import { Stack } from 'expo-router';
import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  GestureResponderEvent,
  ScrollView,
  FlatList,
} from 'react-native';
import { Tabs, MaterialTabBar, MaterialTabItemProps } from 'react-native-collapsible-tab-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SettingIcon from "~/assets/svg/aside/settings.svg"
import HeartIcon from "~/assets/svg/like-filled.svg"
import RetweetIcon from "~/assets/svg/notifications/repost.svg"
import CommentIcon from "~/assets/svg/comment.svg"
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';


import usersData from "~/dummy/users.json";



const notificationsData = [
  {
    id: '1',
    type: 'like',
    mainUser: {
      id: '7', 
    },
    otherCount: 143,
    postPreview: 'Matchday 38: Every goal, every emotion, every moment. What a Premier League season it has been!',
    isRead: false,
    timestamp: '2h',
  },
  ,
  {
    id: '7',
    type: 'reply',
    mainUser: {
      id: '11', 
    },
    otherCount: 0,
    postPreview: 'Love the new Premier League graphics package. Would you be interested in a case study about how it was designed?',
    isRead: true,
    timestamp: '1w',
  },
  {
    id: '2',
    type: 'retweet',
    mainUser: {
      id: '2', 
    },
    otherCount: 87,
    postPreview: 'Congratulations to the Premier League teams that qualified for the 2025/26 UEFA Champions League! Record 6 teams qualified in the group stage.',
    isRead: false,
    timestamp: '1d',
  },
  {
    id: '3',
    type: 'follow',
    mainUser: {
      id: '8', 
    },
    otherCount: 898,
    isRead: true,
    timestamp: '2d',
  },
  {
    id: '4',
    type: 'reply',
    mainUser: {
      id: '3', 
    },
    otherCount: 0,
    postPreview: 'Could you share the top point-scorers from this weekend\'s fixtures?',
    isRead: false,
    timestamp: '3d',
  },
  {
    id: '5',
    type: 'like',
    mainUser: {
      id: '6', 
    },
    otherCount: 523,
    postPreview: 'Research suggests that Premier League footballers cover an average of 10-13km per match, with high-intensity sprints making up to 10% of that distance.',
    isRead: true,
    timestamp: '4d',
  },
  {
    id: '6',
    type: 'retweet',
    mainUser: {
      id: '10', 
    },
    otherCount: 24,
    postPreview: 'Amazing to see how data science and AI are transforming football analysis in the Premier League.',
    isRead: false,
    timestamp: '1w',
  },
  {
    id: '8',
    type: 'like',
    mainUser: {
      id: '9', 
    },
    otherCount: 36,
    postPreview: 'The Premier League app is one of the best examples of cross-platform development we\'ve seen!',
    isRead: false,
    timestamp: '2w',
  },
];

const APP_PRIMARY_COLOR = '#1DA1F2'; 


const formatNumber = (num: number) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};




const ScreenHeader = ({ title, avatarUri }: { title: string; avatarUri: string }) => {
  return (
    <View className="flex-row items-center justify-between px-4 py-3 bg-white ">
      <TouchableOpacity>
        <Image
          source={{ uri: 'https://pbs.twimg.com/profile_images/1742837199005954048/YGI6Kw7P_400x400.jpg' }}
          className="w-10 h-10 rounded-full"
        />
      </TouchableOpacity>
      <Text className="text-xl font-bold text-black">Notifications</Text>
      <TouchableOpacity>
        <SettingIcon width={24} height={24} fill="#000" />
      </TouchableOpacity>
    </View>
  );
};


const CustomTabItem = (props: MaterialTabItemProps<string>) => {
  const { name, index, indexDecimal, onPress, label } = props;
  
  const isActive = Math.round(indexDecimal.value) === index;

  return (
    <TouchableOpacity
      onPress={(e: GestureResponderEvent) => onPress(name)}
      className={`py-3 flex-1 items-center ${isActive ? 'border-b-2 border-blue-500' : ''}`}
    >
      <Text
        className={`text-base ${isActive ? 'font-semibold text-blue-500' : 'text-gray-600'}`}
      >
        {typeof label === 'string' ? label : name}
      </Text>
    </TouchableOpacity>
  );
};


const AvatarRow = ({ userIds, maxVisible = 8 }: { userIds: string[], maxVisible?: number }) => {
  
  const visibleUsers = userIds.slice(0, maxVisible);

  return (
    <View className="flex-row my-2">
      {visibleUsers.map((userId, index) => {
        
        const user = usersData.find(u => u.id === userId);
        if (!user) return null;

        return (
          <Image
            key={userId}
            source={{ uri: user.profile_picture }}
            className="w-10 h-10 rounded-full border-2 border-white"
          
          />
        );
      })}
    </View>
  );
};


const NotificationItem = ({ notification }: { notification: typeof notificationsData[0] }) => {
  const { type, mainUser, otherCount, postPreview, isRead, timestamp } = notification;

  
  const user = usersData.find(u => u.id === mainUser.id);
  if (!user) return null;

  
  const userIds = [mainUser.id];

  
  
  const footballUserIds = ['2', '3', '5', '7', '4', '6', '9'];
  const relevantUserIds = footballUserIds.filter(id => id !== mainUser.id);

  
  const othersToShow = Math.min(otherCount, 7);
  const selectedUserIds = relevantUserIds.slice(0, othersToShow);

  userIds.push(...selectedUserIds);

  
  let icon = null;
  let iconColor = '#000';
  let actionText = '';

  switch (type) {
    case 'like':
      icon = <HeartIcon width={20} height={20} fill="#f91880" />;
      iconColor = '#f91880';
      actionText = `liked your post`;
      break;
    case 'retweet':
      icon = <RetweetIcon width={20} height={20} fill="#00ba7c" />;
      iconColor = '#00ba7c';
      actionText = `retweeted your post`;
      break;
    case 'follow':
      icon = <FontAwesome5 name="user-alt" size={20} color="#1d9bf0" />;
      actionText = `followed you`;
      break;
    case 'reply':
      icon = <CommentIcon width={20} height={20} fill="#1d9bf0" />;
      iconColor = '#1d9bf0';
      actionText = ` replied to your post`;
      break;
  }

  return (
    <TouchableOpacity className={`flex-row px-4 py-3 ${isRead ? 'bg-white' : 'bg-gray-50'} border-b border-gray-100`}>
      
      {icon && (
        <View style={{ width: 24 }} className="mr-3 mt-2 items-center">
          {icon}
        </View>
      )}

      
      <View className="flex-1">
        
        <AvatarRow userIds={userIds} />

        
        <Text className="text-lg mb-1">
          <Text className="font-semibold">{user.name}</Text>
          {otherCount > 0 && (
            <Text className="text-gray-700"> and {formatNumber(otherCount)} others </Text>
          )}
          <Text className="text-gray-700">{actionText}</Text>
        </Text>

        
        {postPreview && type !== 'follow' && (
          <Text className="text-lg text-gray-600 mb-1" numberOfLines={5} ellipsizeMode="tail">
            {postPreview}
          </Text>
        )}

        
        <Text className="text-lg text-gray-500 mt-1">{timestamp}</Text>
      </View>
    </TouchableOpacity>
  );
};


export default function Notifications() {
  


  const insets = useSafeAreaInsets();
  const renderHeader = () => (
    <View style={{ paddingTop: insets.top }} className="bg-white w-full">
      <ScreenHeader
        title="Notifications"
        avatarUri="https://pbs.twimg.com/profile_images/1742837199005954048/YGI6Kw7P_400x400.jpg"
      />
    </View>
  );

  return (
    <View className="flex-1 bg-white" >
      <StatusBar backgroundColor="#fff" barStyle="dark-content" />
      

      <Tabs.Container
        renderHeader={renderHeader}
        pagerProps={{ scrollEnabled: true }}
        renderTabBar={props => (
          <MaterialTabBar
            {...props}
            indicatorStyle={{
              backgroundColor: APP_PRIMARY_COLOR, height: 3, borderRadius: 50
            }}
            activeColor="black"
            scrollEnabled={true}
            style={{
              paddingHorizontal: 16,
              textAlign: 'center',
              elevation: 0, shadowOpacity: 0, borderBottomWidth: 0,
              borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
               backgroundColor: 'white',
            }}

            labelStyle={{
              marginHorizontal: 10,
              opacity: 1,
              fontWeight: 'bold', textTransform: 'capitalize', textAlign: 'center', height: 24,
              color: '#606E79'
            }}
            headerContainerStyle={{
              backgroundColor: 'transparent',
              elevation: 0,
              shadowOpacity: 0,
            }}

          />
        )}

        headerContainerStyle={{
          backgroundColor: 'transparent',
          elevation: 0,
          shadowOpacity: 0,
        }}

        minHeaderHeight={-100}
        revealHeaderOnScroll

      >
        <Tabs.Tab name="All">
          <Tabs.ScrollView>
            {notificationsData.map(notification => (
              <NotificationItem key={notification.id} notification={notification} />
            ))}
          </Tabs.ScrollView>
        </Tabs.Tab>

        <Tabs.Tab name="Mentions">
          <Tabs.ScrollView>
            <View className="p-6 items-center justify-center">
              <Text className="text-gray-500">No mentions yet</Text>
            </View>
          </Tabs.ScrollView>
        </Tabs.Tab>

        <Tabs.Tab name="Verified">
          <Tabs.ScrollView>
            {notificationsData.filter(n => {
              const user = usersData.find(u => u.id === n.mainUser.id);
              return user?.is_verified;
            }).map(notification => (
              <NotificationItem key={notification.id} notification={notification} />
            ))}
          </Tabs.ScrollView>
        </Tabs.Tab>
      </Tabs.Container>
    </View>
  );
}
