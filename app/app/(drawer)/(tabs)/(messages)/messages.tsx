import { Stack } from 'expo-router';
import React, { useState } from 'react'; 
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar, 
  StyleSheet, 
  Dimensions, 
} from 'react-native';
import { SwipeListView } from 'react-native-swipe-list-view'; 
import Pin from "~/assets/svg/chat/pin.svg"
import Report from "~/assets/svg/chat/report.svg"
import Delete from "~/assets/svg/chat/delete.svg"
import Snooze from "~/assets/svg/chat/snooze.svg"
import Request from "~/assets/svg/chat/request.svg"
import Search from "~/assets/svg/tabs/search.svg"
import SettingIcon from "~/assets/svg/aside/settings.svg"
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context';



const initialMessagesData = [
  {
    id: '1',
    key: '1', 
    name: 'Sky Sports Football',
    username: '@SkyFootball',
    time: '1h',
    lastMessage: 'Great highlights package from yesterday! Can we get clearance to use a few clips?',
    avatar: 'https://pbs.twimg.com/profile_images/1605131756310614017/05qwHae-_400x400.jpg', 
    isYou: false,
    is_read: false
  },
  {
    id: '2',
    key: '2',
    name: 'Manchester United',
    username: '@ManUtd',
    time: '3h',
    lastMessage: 'You: Thanks for sending over the updated squad list for the website.',
    avatar: 'https://pbs.twimg.com/profile_images/1889603596309639168/KSBuQ9vL_400x400.png', 
    isYou: true,
    is_read: true
  },
  {
    id: '3',
    key: '3',
    name: 'Fantasy PL',
    username: '@OfficialFPL',
    time: '2d',
    lastMessage: 'You: Reminder to get the Gameweek 30 deadline graphic ready by tomorrow EOD.',
    avatar: 'https://pbs.twimg.com/profile_images/1670723481837633538/H-tSt31R_400x400.jpg', 
    isYou: true,
    is_read: true
  },
  {
    id: '4',
    key: '4',
    name: 'Liverpool FC',
    username: '@LFC',
    time: '2d',
    lastMessage: "Just confirming the kick-off time adjustment for the match on the 25th.",
    avatar: 'https://pbs.twimg.com/profile_images/1856268307868844032/lbdn4-vK_400x400.jpg', 
    isYou: false,
    is_read: false
  },
  {
    id: '5',  
    key: '5',
    name: 'Arsenal',
    username: '@Arsenal',
    time: '4d',
    lastMessage: "You: Approved the submitted matchday photos. Look great!",
    avatar: 'https://pbs.twimg.com/profile_images/1913143252741505026/vdNyLcu3_400x400.jpg', 
    isYou: true,  
    is_read: true
  },
  {
    id: '6',
    key: '6',
    name: 'BBC Sport',
    username: '@BBCSport',
    time: '5d',
    lastMessage: "Following up on the interview request for the Chief Executive.",
    avatar: 'https://pbs.twimg.com/profile_images/1486488950680215553/Rc0iOmOY_400x400.jpg', 
    isYou: false,
    is_read: false
  },
  {
    id: '7',
    key: '7',
    name: 'WWE',
    username: '@WWE',
    time: '2d',
    lastMessage: 'Reminder to get the Gameweek 30 deadline graphic ready by tomorrow EOD.',
    avatar: 'https://pbs.twimg.com/profile_images/1383079031805972485/3sWoMX-R_400x400.jpg', 
    isYou: true,
    is_read: false
  },
  
];





const MessagesHeader = () => {

  return (
    <View className="flex-row items-center justify-between px-4 py-3 bg-white ">
      <TouchableOpacity>
        <Image
          source={{ uri: 'https://pbs.twimg.com/profile_images/1742837199005954048/YGI6Kw7P_400x400.jpg' }}
          className="w-10 h-10 rounded-full"
        />
      </TouchableOpacity>
      <Text className="text-xl font-bold text-black">Messages</Text>
      <TouchableOpacity>
        <SettingIcon width={24} height={24} fill="#000" />
      </TouchableOpacity>
    </View>
  );
};


const SearchBar = () => {
  return (
    <View className="px-4 py-2 bg-white border-b border-gray-300">
      <View className="flex-row items-center bg-[#EEF3F4] rounded-full px-3 py-2 gap-2 align-center justify-center">
        <Search width={16} height={16} fill="#5C6A75" />
        <TextInput
          placeholder="Search Direct Messages"
          placeholderTextColor="#6b7280"
          className=" text-gray-900 text-lg relative -top-1"
        />
      </View>
    </View>
  );
};


const MessageRequests = () => {
  return (
    <TouchableOpacity className="flex-row items-center px-4 py-3 bg-white gap-3 ">
      <View className="w-14 h-14 rounded-full  items-center justify-center border border-gray-200">
        <Request width={24} height={24} fill="#000" />
      </View>
      <View>
        <Text className="text-lg  font-bold text-gray-900">Message requests</Text>
        <Text className="text-base text-gray-600">2 people you may know</Text>
      </View>
    </TouchableOpacity>
  );
};


const MessageItem = ({ data }) => {
  const { item } = data; 
  return (
    
    <TouchableOpacity
      activeOpacity={1} 
      className="flex-row items-start px-4 py-3 bg-white"
      
      onPress={() => console.log('Pressed message:', item.name)}
    >

      <Image
        source={{ uri: item.avatar }}
        className="w-14 h-14 rounded-md mr-4 "

      />

      <View className="flex-1">


        <View className="flex-row items-center mb-1 gap-1">
          <Text className="text-lg font-semibold text-gray-900 mr-1">{item.name}</Text>
          <Image source={{ uri: "https://upload.wikimedia.org/wikipedia/commons/8/81/Twitter_Verified_Badge_Gold.svg" }} className="w-5 h-5 rounded-md" />
          <Text className="text-lg text-gray-500 mr-1">{item.username}</Text>
          <Text className="text-lg text-gray-500">· {item.time}</Text>
        </View>
        <Text className={`text-lg ${!item.is_read ? 'font-semibold text-black' : 'text-gray-600'}`} numberOfLines={2} ellipsizeMode="tail">
          {item.lastMessage}
        </Text>
      </View>
    </TouchableOpacity>
  );
};


const HiddenItemWithActions = ({ data, rowMap, onPin, onReport, onSnooze, onDelete }) => {
  const { item } = data;

  
  const closeRow = () => {
    if (rowMap[item.key]) {
      rowMap[item.key].closeRow();
    }
  };

  return (
    <View style={styles.rowBack}>
      
      <TouchableOpacity
        onPress={() => {
          onPin(item.id);
          
        }}
        className="flex-column items-center gap-3 border-r border-gray-200 w-20"
      >
        <Pin width={24} height={24} fill="#000" />
        <Text className="text-gray-700 text-sm">Pin</Text>
        
      </TouchableOpacity>

      
      <View style={[styles.backRightBtnContainer]}>
        <TouchableOpacity
          onPress={() => {
            onReport(item.id);
            
          }}
          className="flex-column items-center gap-3 border-r border-gray-200 w-20"
        >
          <Report width={24} height={24} fill="#000" />
          <Text className="text-gray-700 text-sm">Report</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            onSnooze(item.id);
            
          }}
          className="flex-column items-center gap-3 border-r border-gray-200 w-20"
        >
          <Snooze width={24} height={24} fill="#000" />
          <Text className="text-gray-700 text-sm">Snooze</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            onDelete(item.id);
            
          }}
          className="flex-column items-center gap-3 w-20"
        >
          <Delete width={24} height={24} fill="#f4222d" />
          <Text className="text-[#f4222d] text-sm ">Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};



export default function Messages() {
  
  const [messages, setMessages] = useState(initialMessagesData);

  
  const handlePin = (id) => {
    console.log('Pin message:', id);
    
  };

  const handleReport = (id) => {
    console.log('Report message:', id);
    
  };

  const handleSnooze = (id) => {
    console.log('Snooze message:', id);
    
  };

  const handleDelete = (id) => {
    console.log('Delete message:', id);
    
    setMessages(prevMessages => prevMessages.filter(message => message.id !== id));
    
  };

  
  const renderHiddenItem = (data, rowMap) => (
    <HiddenItemWithActions
      data={data}
      rowMap={rowMap}
      onPin={handlePin}
      onReport={handleReport}
      onSnooze={handleSnooze}
      onDelete={handleDelete}
    />
  );

  const insets = useSafeAreaInsets();
  
  const swipeRightOpenValue = 240; 
  const swipeLeftOpenValue = 80;   

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top, paddingBottom: insets.bottom * 3 }}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      

      <MessagesHeader />
      <SearchBar />

      

      
      <SwipeListView
        data={messages} 
        renderItem={(data, rowMap) => ( 
          <MessageItem data={data} />
        )}
        renderHiddenItem={renderHiddenItem} 
        
        rightOpenValue={-swipeRightOpenValue} 
        stopRightSwipe={-swipeRightOpenValue - 20} 
        
        leftOpenValue={swipeLeftOpenValue}
        stopLeftSwipe={swipeLeftOpenValue + 20} 
        keyExtractor={(item) => item.key} 
        
        
        
        className="flex-1 bg-white" 
        
        ListHeaderComponent={MessageRequests}
      />

    </View>
  );
}



const styles = StyleSheet.create({
  rowBack: {
    alignItems: 'center',
    
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between', 
    
    
  },
  backRightBtnContainer: {
    flexDirection: 'row', 
    
    
    alignItems: 'center', 
    
    
  },

});