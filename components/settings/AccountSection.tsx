/**
 * Account section of the Settings screen: editable display name + bio
 * (`user.updateMe`), and a read-only campus row. Server
 * validation errors are shown verbatim under the field that caused them.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { confirmAction } from '@/utils/confirm';
import { Text } from '@/components/ui/Text';
import { Input, TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { trpc } from '@/lib/trpc';
import { colors, space } from '@/constants/theme';

export function AccountSection() {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const navigation = useNavigation();

  // Warn before leaving the screen with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    return navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
      confirmAction('Discard changes?', 'You have unsaved edits to your name or bio.', 'Discard', () =>
        navigation.dispatch(e.data.action),
      );
    });
  }, [dirty, navigation]);

  // Seed local edit state from the server once, and whenever a fresh save
  // response comes back (so the fields reflect what actually persisted).
  useEffect(() => {
    if (meQuery.data && !dirty) {
      setDisplayName(meQuery.data.displayName);
      setBio(meQuery.data.bio ?? '');
    }
  }, [meQuery.data, dirty]);

  const updateMutation = trpc.user.updateMe.useMutation({
    onSuccess: async (updated) => {
      setDirty(false);
      setSaved(true);
      setDisplayName(updated.displayName);
      setBio(updated.bio ?? '');
      await utils.auth.me.invalidate();
    },
  });

  if (meQuery.isPending) {
    return (
      <View style={styles.loading}>
        <Skeleton height={48} />
        <Skeleton height={100} />
      </View>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return <ErrorState message={meQuery.error?.message} onRetry={() => meQuery.refetch()} />;
  }

  const canSave = dirty && displayName.trim().length > 0 && !updateMutation.isPending;

  const onSave = () => {
    updateMutation.mutate({
      displayName: displayName.trim(),
      bio: bio.trim().length > 0 ? bio.trim() : undefined,
    });
  };

  return (
    <View style={styles.wrap}>
      <Input
        label="Display name"
        value={displayName}
        onChangeText={(v) => {
          setDisplayName(v);
          setSaved(false);
          setDirty(true);
        }}
        maxLength={60}
        autoCapitalize="words"
      />
      <TextArea
        label="Bio"
        value={bio}
        onChangeText={(v) => {
          setBio(v);
          setSaved(false);
          setDirty(true);
        }}
        maxLength={400}
        placeholder="Say a little about yourself"
      />

      {updateMutation.isError ? (
        <Text variant="caption" color="danger" style={styles.error}>
          {updateMutation.error.message}
        </Text>
      ) : null}

      {dirty ? (
        <Button
          title="Save changes"
          onPress={onSave}
          loading={updateMutation.isPending}
          disabled={!canSave}
          style={styles.save}
        />
      ) : saved ? (
        <Text variant="label" color="success" accessibilityRole="alert">
          Saved
        </Text>
      ) : null}

      <View style={styles.readOnlyRow}>
        <Text variant="label" color="inkMuted">
          Campus
        </Text>
        <Text variant="body">{meQuery.data.campus?.name ?? '—'}</Text>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space.md },
  wrap: { gap: space.lg },
  error: { marginTop: -space.sm },
  save: { alignSelf: 'flex-start' },
  readOnlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
});

export default AccountSection;
