/**
 * Composer for a community post. Collapsed it is a one-line "Post something…"
 * row; tapping expands the kind toggle, a labelled multiline input with a /280
 * counter, and a Post button. The kind is controlled by the parent so it is the
 * same control as the feed's Buyers/Sellers tab. If the viewer's campus email
 * is not verified the requirement is shown up front and Post is disabled.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CheckCircle2, PenLine } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { trpc } from '@/lib/trpc';
import { colors, radius, space } from '@/constants/theme';
import type { CommunityPostKind } from '@/types';

const MAX = 280;
const MIN = 3;

export interface PostComposerProps {
  kind: CommunityPostKind;
  onKind: (kind: CommunityPostKind) => void;
  /** Called after a successful post, with the kind that was posted. */
  onPosted: (kind: CommunityPostKind) => void;
  /** false = known unverified; undefined = still loading (not blocked). */
  campusEmailVerified?: boolean;
}

export function PostComposer({ kind, onKind, onPosted, campusEmailVerified }: PostComposerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);
  const blocked = campusEmailVerified === false;

  const create = trpc.community.create.useMutation({
    onSuccess: (_data, vars) => {
      setBody('');
      setError(null);
      setOpen(false);
      setPosted(true);
      onPosted(vars.kind);
    },
    onError: (e) => setError({ message: e.message, forbidden: e.data?.code === 'FORBIDDEN' }),
  });

  const trimmed = body.trim();
  const canPost = !blocked && trimmed.length >= MIN && trimmed.length <= MAX;
  const nearLimit = body.length >= MAX - 20;

  if (!open) {
    return (
      <View style={styles.collapsedWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post something"
          onPress={() => {
            setPosted(false);
            setOpen(true);
          }}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <PenLine size={20} color={colors.inkMuted} />
          <Text variant="body" color="inkMuted" style={styles.rowText}>
            Post something…
          </Text>
        </Pressable>
        {posted ? (
          <View style={styles.posted} accessibilityRole="alert">
            <CheckCircle2 size={16} color={colors.success} />
            <Text variant="small" color="success">
              Posted. It disappears in 24 hours.
            </Text>
          </View>
        ) : (
          <Text variant="caption" color="inkMuted" style={styles.note}>
            Posts disappear after 24 hours.
          </Text>
        )}
      </View>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.kindRow} accessibilityRole="radiogroup">
        <Chip label="Looking to buy" selected={kind === 'buying'} onPress={() => onKind('buying')} />
        <Chip label="Selling" selected={kind === 'selling'} onPress={() => onKind('selling')} />
      </View>
      {blocked ? (
        <View style={styles.notice}>
          <Text variant="label" color="accentInk">
            Verify your campus email to post. Posting in Community requires a verified campus email (a phone
            number alone is not enough).
          </Text>
          <Button title="Verify in Settings" variant="secondary" onPress={() => router.push('/settings')} />
        </View>
      ) : null}
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        autoFocus
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
        <View style={styles.footerActions}>
          <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
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
      </View>
      <Text variant="caption" color="inkMuted">
        Posts disappear after 24 hours.
      </Text>
      {error ? (
        <View style={styles.error}>
          <Text variant="label" color="danger" accessibilityRole="alert">
            {error.message}
          </Text>
          {error.forbidden ? (
            <Button title="Verify in Settings" variant="secondary" onPress={() => router.push('/settings')} />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  collapsedWrap: { gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1 },
  pressed: { opacity: 0.8 },
  note: { paddingHorizontal: space.md },
  posted: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md },
  card: { gap: space.md },
  kindRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  notice: { gap: space.sm, backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: space.md },
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
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { gap: space.sm },
});

export default PostComposer;
