/**
 * Composer for a community post: kind toggle, labelled multiline input with a
 * /280 counter, and a Post button. If the server says FORBIDDEN (campus email
 * not verified) the message is shown with a button to Settings.
 */
import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { trpc } from '@/lib/trpc';
import { colors, radius, space } from '@/constants/theme';
import type { CommunityPostKind } from '@/types';

const MAX = 280;
const MIN = 3;

export function PostComposer({ onPosted }: { onPosted: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<CommunityPostKind>('buying');
  const [body, setBody] = useState('');
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);

  const create = trpc.community.create.useMutation({
    onSuccess: () => {
      setBody('');
      setError(null);
      onPosted();
    },
    onError: (e) => setError({ message: e.message, forbidden: e.data?.code === 'FORBIDDEN' }),
  });

  const trimmed = body.trim();
  const canPost = trimmed.length >= MIN && trimmed.length <= MAX;
  const nearLimit = body.length >= MAX - 20;

  return (
    <Card style={styles.card}>
      <View style={styles.kindRow} accessibilityRole="radiogroup">
        <Chip label="Looking to buy" selected={kind === 'buying'} onPress={() => setKind('buying')} />
        <Chip label="Selling" selected={kind === 'selling'} onPress={() => setKind('selling')} />
      </View>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={MAX}
        allowFontScaling
        accessibilityLabel="Write a post"
        placeholder={kind === 'buying' ? 'Does anyone have shirts?' : 'Anyone interested in buying shirts?'}
        placeholderTextColor={colors.inkFaint}
        style={styles.input}
      />
      <View style={styles.footer}>
        <Text
          variant="caption"
          color={nearLimit ? 'danger' : 'inkMuted'}
          accessibilityLabel={`${body.length} of ${MAX} characters`}
        >
          {body.length}/{MAX}
        </Text>
        <Button
          title="Post"
          onPress={() => {
            setError(null);
            create.mutate({ kind, body: trimmed });
          }}
          disabled={!canPost}
          loading={create.isPending}
        />
      </View>
      {error ? (
        <View style={styles.error}>
          <Text variant="label" color="danger" accessibilityRole="alert">
            {error.message}
          </Text>
          {error.forbidden ? (
            <Button title="Go to Settings" variant="secondary" onPress={() => router.push('/settings')} />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  kindRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  input: {
    minHeight: 72,
    maxHeight: 160,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.bg,
    textAlignVertical: 'top',
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  error: { gap: space.sm },
});

export default PostComposer;
