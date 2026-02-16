import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { signOut } from 'firebase/auth';
import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchUserProfile, uploadAvatar } from '@/services/api';
import { auth } from '@/services/firebase';
import { useAuthStore } from '@/store/authStore';

const MAX_AVATAR_BASE64_LENGTH = 950_000;

async function encodeAvatarBase64(uri: string): Promise<string> {
  const targetWidths = [720, 640, 560, 480, 400, 320];
  const compressions = [0.7, 0.6, 0.5, 0.4, 0.3, 0.2];

  for (const width of targetWidths) {
    for (const compress of compressions) {
      const context = ImageManipulator.manipulate(uri);
      context.resize({ width });
      const rendered = await context.renderAsync();
      const result = await rendered.saveAsync({
        base64: true,
        format: SaveFormat.JPEG,
        compress,
      });

      if (result.base64 && result.base64.length <= MAX_AVATAR_BASE64_LENGTH) {
        return result.base64;
      }
    }
  }

  throw new Error('Image is too large. Please choose a smaller image.');
}

export function ProfileScreen() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['profile', user?.uid],
    enabled: Boolean(user?.uid),
    queryFn: () => fetchUserProfile(user!.uid),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60 * 24 * 7,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!user?.uid) {
        throw new Error('Missing uid');
      }
      const source = await new Promise<'camera' | 'library' | null>((resolve) => {
        Alert.alert('Choose Image Source', 'How would you like to set your avatar?', [
          { text: 'Take Photo', onPress: () => resolve('camera') },
          { text: 'Choose from Library', onPress: () => resolve('library') },
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        ]);
      });

      if (!source) {
        return;
      }

      let picked: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          throw new Error('Camera permission is required.');
        }
        picked = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          base64: false,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          throw new Error('Photo library permission is required.');
        }
        picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          base64: false,
        });
      }

      if (picked.canceled || !picked.assets[0]?.uri) {
        return;
      }

      const base64 = await encodeAvatarBase64(picked.assets[0].uri);

      await uploadAvatar(user.uid, base64);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profile', user?.uid] });
    },
    onError: (error) => Alert.alert('Upload failed', String(error)),
  });

  const avatarBase64 = profileQuery.data?.avatar;

  return (
    <View style={styles.container}>
      <Pressable style={styles.avatarWrap} onPress={() => uploadMutation.mutate()}>
        {avatarBase64 ? (
          <Image source={{ uri: `data:image/jpeg;base64,${avatarBase64}` }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>Tap</Text>
          </View>
        )}
      </Pressable>

      <Text style={styles.name}>{profileQuery.data?.username ?? user?.displayName ?? user?.email ?? 'Unknown'}</Text>
      <Text style={styles.uid}>UID: {user?.uid}</Text>

      <Pressable style={styles.uploadBtn} onPress={() => uploadMutation.mutate()}>
        <Text style={styles.uploadText}>{uploadMutation.isPending ? 'Uploading...' : 'Upload Avatar'}</Text>
      </Pressable>

      <Pressable
        style={styles.logoutBtn}
        onPress={async () => {
          try {
            await signOut(auth);
          } catch (error) {
            Alert.alert('Logout failed', String(error));
          }
        }}
      >
        <Text style={styles.logoutText}>Logout</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F2FAF5',
    padding: 16,
  },
  avatarWrap: {
    borderRadius: 80,
    overflow: 'hidden',
  },
  avatar: {
    width: 130,
    height: 130,
    borderRadius: 65,
  },
  avatarPlaceholder: {
    backgroundColor: '#D7E8DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#1D6F42',
    fontWeight: '700',
  },
  name: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '700',
    color: '#1D6F42',
  },
  uid: {
    color: '#4C6D59',
    fontSize: 12,
  },
  uploadBtn: {
    marginTop: 10,
    backgroundColor: '#1D6F42',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  uploadText: {
    color: '#FFF',
    fontWeight: '700',
  },
  logoutBtn: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B93C2D',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  logoutText: {
    color: '#B93C2D',
    fontWeight: '700',
  },
});
