/**
 * Profile-picture upload. Reuses the listing-photo path exactly: the same
 * expo-image-picker call as PhotoPickerRow, the same `uploadImage` (POST
 * /api/uploads, same auth, size and type rules), then the returned URL is
 * saved with user.updateMe. No second upload mechanism.
 */
import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { trpc, uploadImage } from '@/lib/trpc';

export function useAvatarUpload() {
  const utils = trpc.useUtils();
  const update = trpc.user.updateMe.useMutation();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access in your settings to add a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploading(true);
    try {
      const url = await uploadImage(result.assets[0]!.uri);
      await update.mutateAsync({ avatarUrl: url });
      await Promise.all([utils.auth.me.invalidate(), utils.user.byId.invalidate()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be uploaded. Try again.');
    } finally {
      setUploading(false);
    }
  }, [update, utils]);

  return { pick, uploading, error };
}
