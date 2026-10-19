import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  SafeAreaView,
  StatusBar, 
  Platform, 
} from 'react-native';
import { Stack } from 'expo-router';




import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


interface HeaderProps {
  title: string;
  rightContent?: React.ReactNode;
  centerContent?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ title, rightContent, centerContent }) => {
  return (
    <View className="flex-row items-center justify-center px-4 py-3  pb-8">
      
      <View className="flex-row items-center absolute left-4">
        <TouchableOpacity className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
          
          <Text className="text-gray-600 text-xs">U</Text>
        </TouchableOpacity>
      </View>

      
      <View className="flex-1 absolute center">
        {centerContent}
      </View>

      
      <View className="flex-row items-center absolute right-4">
        {rightContent}
      </View>

    </View>
  );
};


interface FeatureCardProps {
  icon: React.ReactNode; 
  title: string;
  description: string;
}


const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description }) => {
  return (
    <View className="bg-[#E5E7EB] p-4 rounded-lg mb-4">
      <View className="flex-row items-center mb-2 self-start px-3 py-0.5 rounded-lg border border-gray-300">
        {icon}
        <Text className="text-base font-bold ml-2 text-gray-900">{title}</Text>
      </View>
      <Text className="text-[16px] text-gray-700">{description}</Text>
    </View>
  );
};



export default function Grok() {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView
      className={`flex-1 bg-[#F4F4F4]`}
      style={{ marginBottom: insets.bottom + 50 }}
    >

      
      <View className="flex-1">
        <Header
          centerContent={
            <View className="flex-row items-center gap-1">
              <Text className="text-lg font-bold text-black">Grok 3</Text>
              <Text className="text-lg font-bold text-[#2999E2] bg-[#e0f5ff] items-center justify-center px-2 rounded-xl">beta</Text>
            </View>
          }
          rightContent={
            <View className="flex-row items-center space-x-4 gap-4">
              <TouchableOpacity>
                <Feather name="clock" size={24} color="black" />
              </TouchableOpacity>
              <TouchableOpacity>
                <Feather name="edit" size={24} color="black" />
              </TouchableOpacity>
            </View>
          }
        />
        <ScrollView
          className="flex-1 px-4 pt-4" 
          contentContainerStyle={{ paddingBottom: 20 }} 
        
        
        
        
        >
          
          <Text className="text-2xl font-extrabold mb-2 text-black">Grok 3 is here.</Text>
          <Text className="text-base text-gray-600 mb-6 ">
            Try our new features: DeepSearch, Think, and Edit Image
          </Text>

          
          <FeatureCard
            icon={<MaterialCommunityIcons name="text-box-search-outline" size={16} color="black" />}
            title="DeepSearch"
            description="Search deeply to deliver detailed, well-reasoned answers with Grok's rapid, agentic search."
          />
          <FeatureCard
            icon={<MaterialCommunityIcons name="lightbulb-outline" size={16} color="black" />}
            title="Think"
            description="Solve the hardest problems in math, science, and coding with our reasoning model."
          />
          <FeatureCard
            icon={<MaterialCommunityIcons name="image-edit-outline" size={16} color="black" />}
            title="Edit Image"
            description="Transform your images with style transfers, edits, and more."
          />

        </ScrollView>

        
        <View className="px-4 py-3  border-t border-gray-100">
          <View className="flex-row items-center bg-gray-200 rounded-2xl p-2 py-6">

            <View className="flex-1 flex-col">
              <TextInput
                placeholder="Ask anything"

                placeholderTextColor="#6b7280"
                className="flex-1 px-3 text-lg text-gray-900 min-h-10 w-full pb-5"
              />


              <View className="flex-row items-center justify-between">
                

                <View className="flex-row items-center gap-2">
                  <TouchableOpacity className="p-1.5 bg-gray-300 rounded-xl">
                    <MaterialCommunityIcons name="paperclip" size={20} color="#4b5563" />
                  </TouchableOpacity>
                  <TouchableOpacity className="p-1.5 bg-gray-300 rounded-xl">
                    <View className="w-5 h-5 rounded-full border-2 border-gray-600"></View>
                  </TouchableOpacity>
                  <TouchableOpacity className="p-1.5 bg-gray-300 rounded-xl">
                    <MaterialCommunityIcons name="lightbulb-outline" size={20} color="#4b5563" />
                  </TouchableOpacity>
                  <TouchableOpacity className="p-1.5 bg-gray-300 rounded-xl">
                    <MaterialCommunityIcons name="image-edit-outline" size={20} color="#4b5563" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity className="">
                  <MaterialCommunityIcons name="microphone" size={22} color="#4b5563" />
                </TouchableOpacity>
              </View>

            </View>

          </View>
        </View>

      </View>
    </SafeAreaView>
  );
}
