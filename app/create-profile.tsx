/**
 * Profile setup, shown once right after someone creates an account on the
 * front door (/welcome). Photo, name and a short bio — all saved through
 * `user.updateMe`, the same call Settings uses, so anything set here can be
 * changed there later.
 *
 * Nothing here is required beyond the name the account already has: "Skip for
 * now" goes straight into the app. Signed-out visitors are sent back to the
 * front door, since there is no account to set up.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Input, TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { TextLink } from '@/components/ui/TextLink';
import { Skeleton } from '@/components/ui/Skeleton';
import { Notice } from '@/components/auth/Notice';
import { useAuth } from '@/hooks/useAuth';
import { trpc, uploadImage, resolveMediaUrl } from '@/lib/trpc';
import { colors, radius, shadow, space } from '@/constants/theme';

const WORDMARK = require('../assets/branding/dibbs-wordmark-white.png');
const AVATAR = 112;

export default function CreateProfileScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery(undefined, { enabled: status === 'signedIn' });

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [seeded, setSeeded] = useState(false);

  // Start from what the account already has (the name typed at sign-up).
  // Done during render, once, rather than in an effect: React re-runs this
  // render with the new values straight away, with no extra paint.
  if (meQuery.data && !seeded) {
    setSeeded(true);
    setDisplayName(meQuery.data.displayName ?? '');
    setBio(meQuery.data.bio ?? '');
    setAvatarUrl(meQuery.data.avatarUrl ?? null);
  }

  const save = trpc.user.updateMe.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      router.replace('/');
    },
    onError: (e) => setError(e.message),
  });

  if (status === 'signedOut') return <Redirect href="/welcome" />;

  async function pickPhoto() {
    setError(undefined);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setLocalPhoto(uri);
    setUploading(true);
    try {
      setAvatarUrl(await uploadImage(uri));
    } catch {
      setLocalPhoto(null);
      setError('That photo didn’t upload. Try another, or skip it for now.');
    } finally {
      setUploading(false);
    }
  }

  const onSave = () => {
    if (!displayName.trim()) {
      setError('Add the name other students will see.');
      return;
    }
    setError(undefined);
    save.mutate({
      displayName: displayName.trim(),
      bio: bio.trim(),
      ...(avatarUrl ? { avatarUrl } : {}),
    });
  };

  const loading = status === 'loading' || (meQuery.isPending && !meQuery.isError);
  const photoUri = localPhoto ?? resolveMediaUrl(avatarUrl);

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ headerShown: false, title: 'Make your profile' }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.band}>
          <Image source={WORDMARK} accessibilityLabel="Dibbs" contentFit="contain" style={styles.wordmark} />
        </View>

        <View style={styles.card}>
          <Text variant="displaySm" accessibilityRole="header" style={styles.title}>
            Make your profile
          </Text>
          <Text variant="body" color="inkMuted">
            This is what other students see when you list something or book a meetup. You can change it any time in
            Settings.
          </Text>

          {meQuery.isError ? (
            <ErrorState message={meQuery.error.message} onRetry={() => meQuery.refetch()} />
          ) : loading ? (
            <View style={styles.form}>
              <Skeleton height={AVATAR} width={AVATAR} />
              <Skeleton height={48} />
              <Skeleton height={100} />
            </View>
          ) : (
            <View style={styles.form}>
              <Pressable
                onPress={pickPhoto}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel={photoUri ? 'Change profile photo' : 'Add a profile photo'}
                style={styles.photoRow}
              >
                <View>
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" transition={150} />
                  ) : (
                    <View style={[styles.photo, styles.initialWrap]}>
                      <Text variant="display" weight="700" color="accentInk">
                        {displayName.trim()[0]?.toUpperCase() ?? '+'}
                      </Text>
                    </View>
                  )}
                  {uploading ? (
                    <View style={[styles.photo, styles.overlay]}>
                      <ActivityIndicator color={colors.white} />
                    </View>
                  ) : null}
                  <View style={styles.cameraBadge}>
                    <Camera size={16} color={colors.white} />
                  </View>
                </View>
                <View style={styles.photoText}>
                  <Text variant="heading" weight="700">
                    {photoUri ? 'Change photo' : 'Add a photo'}
                  </Text>
                  <Text variant="label" color="inkMuted">
                    Optional. So the person you’re meeting can recognise you.
                  </Text>
                </View>
              </Pressable>

              <Input
                label="Name"
                value={displayName}
                onChangeText={(v) => {
                  setDisplayName(v);
                  setError(undefined);
                }}
                maxLength={60}
                autoCapitalize="words"
                placeholder="e.g. Maya"
              />
              <TextArea
                label="Bio (optional)"
                value={bio}
                onChangeText={setBio}
                maxLength={400}
                placeholder="Major, dorm, what you usually sell — whatever you’re happy sharing."
              />

              {error ? <Notice tone="error">{error}</Notice> : null}

              <Button
                title="Save and start browsing"
                onPress={onSave}
                loading={save.isPending}
                disabled={uploading || save.isPending}
              />
              <TextLink align="center" onPress={() => router.replace('/')}>Skip for now</TextLink>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingBottom: 72 },
  band: { backgroundColor: colors.brand, paddingTop: 36, paddingBottom: 64, alignItems: 'center' },
  wordmark: { width: 170, aspectRatio: 900 / 376 },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    marginTop: -36,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    padding: 28,
    gap: space.sm,
    ...shadow,
  },
  title: { marginBottom: space.xs },
  form: { gap: space.lg, marginTop: space.lg },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  photo: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: colors.surfaceMuted },
  initialWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.accent,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cameraBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoText: { flex: 1, gap: space.xs },
});
