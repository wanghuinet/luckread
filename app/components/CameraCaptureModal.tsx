import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';

export type CapturedCameraPhoto = {
  uri: string;
  width: number;
  height: number;
};

type CameraCaptureModalProps = {
  visible: boolean;
  onClose: () => void;
  onCapture: (photo: CapturedCameraPhoto) => void;
};

/**
 * Native camera capture for the social composer.
 * Camera access is requested only after the user opens this surface.
 * Photo files immediately enter the existing W01 upload pipeline.
 */
export default function CameraCaptureModal({
  visible,
  onClose,
  onCapture,
}: CameraCaptureModalProps) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!visible) {
      setCameraReady(false);
      setCapturing(false);
      setErrorMessage('');
    }
  }, [visible]);

  if (!visible) return null;

  const handlePermission = async () => {
    setErrorMessage('');
    try {
      if (permission?.canAskAgain === false) {
        await Linking.openSettings();
        return;
      }
      await requestPermission();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to request camera permission.');
    }
  };

  const takePhoto = async () => {
    if (!cameraReady || capturing || !cameraRef.current) return;
    setCapturing(true);
    setErrorMessage('');
    try {
      const picture = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        exif: false,
        base64: false,
      });
      if (!picture?.uri || picture.uri.startsWith('data:')) {
        throw new Error('The camera did not return a local photo file. Use the photo library instead.');
      }
      onCapture({
        uri: picture.uri,
        width: picture.width,
        height: picture.height,
      });
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to take this photo. Please retry.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {permission === null ? (
          <View style={styles.permissionState}>
            <ActivityIndicator color="#ffffff" size="large" />
            <Text style={styles.message}>Checking camera permission…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.permissionState}>
            <Feather name="camera" size={38} color="#ffffff" />
            <Text style={styles.title}>Allow camera access</Text>
            <Text style={styles.message}>
              LuckRead uses the camera only when you choose to take a photo for a post.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => { void handlePermission(); }} style={styles.permissionButton}>
              <Text style={styles.permissionButtonText}>
                {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode="picture"
              onCameraReady={() => setCameraReady(true)}
              onMountError={(event) => {
                setCameraReady(false);
                setErrorMessage(event.message);
              }}
            />
            <View style={[styles.topBar, Platform.OS === 'ios' && styles.topBarIOS]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={onClose} style={styles.iconButton}>
                <Feather name="x" size={24} color="#ffffff" />
              </Pressable>
              <Text style={styles.topTitle}>Take a photo</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Switch camera"
                onPress={() => setFacing((current) => current === 'back' ? 'front' : 'back')}
                style={styles.iconButton}
              >
                <Feather name="refresh-cw" size={21} color="#ffffff" />
              </Pressable>
            </View>
            {errorMessage ? (
              <View accessibilityLiveRegion="assertive" style={styles.errorBanner}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}
            <View style={styles.bottomBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take photo"
                accessibilityState={{ disabled: !cameraReady || capturing }}
                disabled={!cameraReady || capturing}
                onPress={() => { void takePhoto(); }}
                style={[styles.shutterOuter, (!cameraReady || capturing) && styles.disabled]}
              >
                {capturing ? (
                  <ActivityIndicator color="#111827" />
                ) : (
                  <View style={styles.shutterInner} />
                )}
              </Pressable>
              <Text style={styles.hint}>{cameraReady ? 'Photo will be added to your post' : 'Camera is getting ready…'}</Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  permissionState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  title: { color: '#ffffff', fontSize: 21, fontWeight: '800', textAlign: 'center' },
  message: { color: '#d1d5db', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  permissionButton: { marginTop: 8, borderRadius: 999, backgroundColor: '#ffffff', paddingHorizontal: 24, paddingVertical: 12 },
  permissionButtonText: { color: '#111827', fontSize: 14, fontWeight: '800' },
  cancelButton: { paddingHorizontal: 20, paddingVertical: 10 },
  cancelText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarIOS: { paddingTop: 54 },
  topTitle: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  errorBanner: { position: 'absolute', left: 16, right: 16, bottom: 130, padding: 12, borderRadius: 12, backgroundColor: 'rgba(127,29,29,0.9)' },
  errorText: { color: '#ffffff', fontSize: 13, lineHeight: 18 },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 22, paddingBottom: 38, backgroundColor: 'rgba(0,0,0,0.24)' },
  shutterOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.25)' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#ffffff' },
  disabled: { opacity: 0.55 },
  hint: { marginTop: 12, color: '#ffffff', fontSize: 12, fontWeight: '600' },
});
