import React, { useEffect, useState, useCallback, memo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
  StyleSheet
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/store';
import users from '../dummy/users.json';
import authorizedAccounts from '../dummy/authorized_accounts.json';
import { Feather } from '@expo/vector-icons';
import Sortable from 'react-native-sortables';
import { useRouter } from 'expo-router';


type User = {
  id: string;
  name: string;
  handle: string;
  profile_picture: string;
  is_verified: boolean;
  verified_badge: string;
};


type AccountItemProps = {
  item: User;
  currentUserId: string | null;
};


const AccountItem = memo(({ item, currentUserId }: AccountItemProps) => {
  return (
    <View style={styles.accountItem}>
      
      <View style={styles.subtractContainer}>
        <Feather name="minus" size={16} color="white" />
      </View>

      
      <Image
        source={{ uri: item.profile_picture }}
        style={styles.profileImage}
        onError={(e) => console.log("Failed to load image", e.nativeEvent.error)}
      />

      <View style={styles.accountInfo}>
        <View style={styles.nameContainer}>
          <Text style={styles.nameText}>{item.name}</Text>
          {item.is_verified && (
            <Image
              source={{ uri: item.verified_badge }}
              style={styles.verifiedBadge}
              onError={(e) => console.log("Failed to load image", e.nativeEvent.error)}
            />
          )}
        </View>
        <Text style={styles.handleText}>@{item.handle}</Text>
      </View>

      
      <Sortable.Handle>
        <View style={styles.handleContainer}>
          <Feather name="menu" size={22} color="#767676" />
        </View>
      </Sortable.Handle>
    </View>
  );
});


export default function EditAccountsScreen() {
  const insets = useSafeAreaInsets();
  const { currentUserId } = useStore();
  const router = useRouter();
  
  const [orderedAccounts, setOrderedAccounts] = useState<User[]>([]);

  
  useEffect(() => {
    
    const authorizedUsers = users.filter(user =>
      authorizedAccounts.includes(user.id)
    );

    setOrderedAccounts(authorizedUsers);
  }, []);

  
  const handleSaveOrder = () => {
    router.back();
  };

  
  const renderItem = useCallback(({ item }: { item: User }) => (
    <AccountItem
      key={item.id}
      item={item}
      currentUserId={currentUserId}
    />
  ), [currentUserId]);

  
  const handleDragEnd = (params: any) => {
    console.log('Sortable.Grid onDragEnd params:', params);
    if (params.from !== undefined && params.to !== undefined) {
      setOrderedAccounts(currentAccounts => {
        const newAccounts = [...currentAccounts];
        const [movedItem] = newAccounts.splice(params.from, 1);
        newAccounts.splice(params.to, 0, movedItem);
        return newAccounts;
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleSaveOrder}
          style={styles.doneButton}
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Accounts</Text>
      </View>

      
      <View style={styles.gridContainer}>
        <Sortable.Grid
          data={orderedAccounts}
          renderItem={renderItem}
          onDragEnd={handleDragEnd}
          columns={1}
          customHandle={true}
          rowGap={0}
          overDrag="vertical"
          activeItemScale={1.02}
        />
      </View>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0'
  },
  doneButton: {
    padding: 4,
    position: 'absolute',
    left: 16
  },
  doneText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'black'
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 'bold'
  },
  gridContainer: {
    flex: 1,
    width: '100%'
  },
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: 'white',
    width: '100%'
  },
  handleContainer: {
    padding: 4
  },
  subtractContainer: {
    width: 24,
    height: 24,
    borderRadius: 14,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#FF3B30'
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 12
  },
  accountInfo: {
    flex: 1,
    justifyContent: 'center'
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  nameText: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 4
  },
  verifiedBadge: {
    width: 16,
    height: 16
  },
  handleText: {
    fontSize: 14,
    color: '#657786'
  }
});