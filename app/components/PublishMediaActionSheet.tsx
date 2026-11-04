import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type PublishMediaAction = 'camera' | 'library';

type PublishMediaActionSheetProps = {
  visible: boolean;
  disabled?: boolean;
  remainingCount: number;
  onClose: () => void;
  onTakePhoto: () => void;
  onPickMedia: () => void;
};

/**
 * X-style media action chooser for the native post composer.
 * Reuses the app-level Gorhom modal provider; native pickers launch only
 * after the chooser has finished dismissing to avoid overlapping native UI.
 */
export default function PublishMediaActionSheet({
  visible,
  disabled = false,
  remainingCount,
  onClose,
  onTakePhoto,
  onPickMedia,
}: PublishMediaActionSheetProps) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const pendingActionRef = useRef<PublishMediaAction | null>(null);
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const foreground = isDark ? '#f9fafb' : '#0f1419';
  const muted = isDark ? '#9ca3af' : '#536471';
  const surface = isDark ? '#111111' : '#ffffff';
  const border = isDark ? '#303030' : '#e5e7eb';
  const snapPoints = useMemo(() => ['36%'], []);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const handleDismiss = useCallback(() => {
    const pendingAction = pendingActionRef.current;
    pendingActionRef.current = null;
    onClose();

    if (pendingAction === 'camera') onTakePhoto();
    if (pendingAction === 'library') onPickMedia();
  }, [onClose, onPickMedia, onTakePhoto]);

  const dismissForAction = useCallback((action: PublishMediaAction) => {
    if (disabled) return;
    pendingActionRef.current = action;
    sheetRef.current?.dismiss();
  }, [disabled]);

  const backdropComponent = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={0.48}
      pressBehavior="close"
    />
  ), []);

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={!disabled}
      backdropComponent={backdropComponent}
      onDismiss={handleDismiss}
      backgroundStyle={{
        backgroundColor: surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#575757' : '#c7cdd3', width: 42 }}
    >
      <BottomSheetView
        style={[
          styles.content,
          {
            paddingBottom: Math.max(insets.bottom, 16),
            backgroundColor: surface,
          },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headingGroup}>
            <Text style={[styles.title, { color: foreground }]}>Add to your post</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              {remainingCount} {remainingCount === 1 ? 'attachment' : 'attachments'} remaining
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close media actions"
            onPress={() => sheetRef.current?.dismiss()}
            style={styles.closeButton}
          >
            <Feather name="x" size={21} color={foreground} />
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => dismissForAction('camera')}
            style={[styles.action, { borderColor: border, backgroundColor: isDark ? '#18181b' : '#f9fafb' }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: isDark ? '#27272a' : '#e8f4ff' }]}>
              <Feather name="camera" size={22} color="#1769aa" />
            </View>
            <Text style={[styles.actionTitle, { color: foreground }]}>Take photo</Text>
            <Text style={[styles.actionDescription, { color: muted }]}>Open the camera</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose photos or video from library"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => dismissForAction('library')}
            style={[styles.action, { borderColor: border, backgroundColor: isDark ? '#18181b' : '#f9fafb' }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: isDark ? '#27272a' : '#e8f4ff' }]}>
              <Feather name="image" size={22} color="#1769aa" />
            </View>
            <Text style={[styles.actionTitle, { color: foreground }]}>Choose from library</Text>
            <Text style={[styles.actionDescription, { color: muted }]}>Photos and videos</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  headingGroup: { flex: 1 },
  title: { fontSize: 17, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 4 },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  action: { flex: 1, minHeight: 128, borderWidth: 1, borderRadius: 16, padding: 14, justifyContent: 'center' },
  actionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  actionTitle: { fontSize: 14, fontWeight: '800' },
  actionDescription: { fontSize: 12, marginTop: 4 },
});
