import { View, Text, TouchableOpacity, Image } from "react-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useStore } from "../../store/store";
import users from "../../dummy/users.json";

export default function Home() {
  const router = useRouter();
  const { setCurrentUserId } = useStore();
  const [selectedUserIndex, setSelectedUserIndex] = useState(0);

  useEffect(() => {
    if (users.length > 0) {
      setCurrentUserId(users[selectedUserIndex].id);
    }
  }, [selectedUserIndex]);

  const navigateToTabs = () => {
    router.push("/(drawer)/(tabs)/(index)");
  };

  const handleNextUser = () => {
    if (users.length > 1) {
      setSelectedUserIndex((prev) => (prev + 1) % users.length);
    }
  };

  const currentUser = users[selectedUserIndex];

  return (
    <View className="flex-1 bg-black justify-center py-10 px-8 gap-10">
      <Text className="text-[100px] text-white mb-10">𝕏</Text>
      <View className="gap-2 flex-col">
        <Text className="text-5xl font-bold text-white mb-2.5 tracking-tighter">Happening now</Text>
        <Text className="text-3xl font-semibold text-white mb-12 tracking-tighter">Join today.</Text>
      </View>
      <TouchableOpacity
        className="bg-white py-4 px-6 rounded-full w-full items-center flex-row"
        onPress={navigateToTabs}
      >
        {currentUser && (
          <>
            <Image
              source={{ uri: currentUser.profile_picture }}
              className="w-8 h-8 rounded-full mr-4"
            />
            <Text className="text-black text-lg font-bold">Continue with @{currentUser.handle}</Text>
          </>
        )}
        {!currentUser && (
          <Text className="text-black text-lg font-bold">Continue</Text>
        )}
      </TouchableOpacity>

      {users.length > 1 && (
        <TouchableOpacity
          className="items-center mt-2"
          onPress={handleNextUser}
        >
          <Text className="text-[#1d9bf0] text-base">Switch account</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}