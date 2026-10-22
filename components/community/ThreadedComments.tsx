/**
 * Shared look for one-level comment threads (community posts and listings):
 * top-level comments, indented replies, a "Comment deleted" placeholder when a
 * parent is gone, and a composer with reply targeting. Data and rules stay with
 * the caller; this only shows what it is given.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { colors, radius, space } from '@/constants/theme';
import { formatRelative } from '@/utils/format';

export const COMMENT_MAX = 500;

export type ThreadItem = {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: Date | string;
  author: { id: string; displayName: string; avatarUrl?: string | null };
  isMine?: boolean;
  isSeller?: boolean;
  canRemove: boolean;
};

type Props = {
  items: ThreadItem[];
  emptyText: string;
  /** Right-hand slot per comment (vote button). */
  renderTrailing?: (item: ThreadItem) => React.ReactNode;
  onDelete: (id: string) => void;
  /** Hide the composer entirely (comments closed). */
  closedText?: string;
  /** Returns false when the viewer must sign in first. */
  ensureAuth: () => boolean;
  onSubmit: (body: string, parentId: string | undefined) => void;
  submitting: boolean;
  /** Bumps when a submit succeeded, so the composer clears. */
  clearSignal: number;
  error: string | null;
  clearError: () => void;
  deleteLabel?: string;
};

export function ThreadedComments(p: Props) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<ThreadItem | null>(null);
  const [seenSignal, setSeenSignal] = useState(p.clearSignal);
  if (seenSignal !== p.clearSignal) {
    setSeenSignal(p.clearSignal);
    setBody('');
    setTarget(null);
  }

  const ids = new Set(p.items.map((c) => c.id));
  const tops = p.items.filter((c) => c.parentId === null);
  const repliesOf = (id: string) => p.items.filter((c) => c.parentId === id);
  const orphanParents = Array.from(
    new Set(p.items.filter((c) => c.parentId !== null && !ids.has(c.parentId)).map((c) => c.parentId as string)),
  );
  const trimmed = body.trim();

  const renderComment = (c: ThreadItem, reply: boolean) => (
    <View key={c.id} style={[styles.row, reply && styles.replyRow]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${c.author.displayName}'s profile`}
        onPress={() => router.push(`/user/${c.author.id}`)}
        hitSlop={4}
      >
        <Avatar uri={c.author.avatarUrl} name={c.author.displayName} size={reply ? 22 : 28} />
      </Pressable>
      <View style={styles.main}>
        <View style={styles.meta}>
          <Text variant="label" weight="700" numberOfLines={1} style={styles.name}>
            {c.isMine ? `${c.author.displayName} (you)` : c.author.displayName}
          </Text>
          {c.isSeller ? (
            <View style={styles.pill}>
              <Text variant="caption" color="inkMuted" weight="700">
                Seller
              </Text>
            </View>
          ) : null}
          <Text variant="caption" color="inkFaint">
            {formatRelative(c.createdAt)}
          </Text>
        </View>
        <Text variant="body" style={styles.text}>
          {c.body}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Reply to ${c.author.displayName}`}
            onPress={() => {
              if (!p.ensureAuth()) return;
              setTarget(c);
            }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text variant="label" color="inkMuted">
              Reply
            </Text>
          </Pressable>
          {c.canRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={p.deleteLabel ?? 'Delete comment'}
              onPress={() => p.onDelete(c.id)}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Text variant="label" color="inkMuted">
                Delete
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {p.renderTrailing?.(c)}
    </View>
  );

  return (
    <View style={styles.wrap}>
      {p.items.length === 0 ? (
        <Text variant="label" color="inkMuted">
          {p.emptyText}
        </Text>
      ) : (
        <>
          {tops.map((c) => (
            <View key={c.id} style={styles.thread}>
              {renderComment(c, false)}
              {repliesOf(c.id).map((r) => renderComment(r, true))}
            </View>
          ))}
          {orphanParents.map((pid) => (
            <View key={pid} style={styles.thread}>
              <Text variant="label" color="inkFaint" style={styles.deleted}>
                Comment deleted
              </Text>
              {repliesOf(pid).map((r) => renderComment(r, true))}
            </View>
          ))}
        </>
      )}

      {p.closedText ? (
        <Text variant="label" color="inkMuted">
          {p.closedText}
        </Text>
      ) : (
        <View style={styles.composer}>
          {target ? (
            <View style={styles.replyingTo}>
              <Text variant="label" color="inkMuted" numberOfLines={1} style={styles.name}>
                Replying to {target.author.displayName}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                onPress={() => setTarget(null)}
                hitSlop={8}
                style={styles.cancel}
              >
                <X size={18} color={colors.inkMuted} />
              </Pressable>
            </View>
          ) : null}
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={COMMENT_MAX}
            allowFontScaling
            accessibilityLabel={target ? 'Write a reply' : 'Write a comment'}
            placeholder={target ? 'Write a reply' : 'Add a comment'}
            placeholderTextColor={colors.inkFaint}
            // Tapping the field while signed out goes to sign-in instead.
            onFocus={() => {
              p.ensureAuth();
            }}
            style={styles.input}
          />
          <View style={styles.footer}>
            <Text
              variant="caption"
              color={body.length >= COMMENT_MAX - 20 ? 'danger' : 'inkMuted'}
              accessibilityLabel={`${body.length} of ${COMMENT_MAX} characters`}
            >
              {body.length}/{COMMENT_MAX}
            </Text>
            <Button
              title={target ? 'Reply' : 'Comment'}
              onPress={() => {
                if (!p.ensureAuth()) return;
                p.clearError();
                p.onSubmit(trimmed, target?.id);
              }}
              disabled={trimmed.length === 0}
              loading={p.submitting}
            />
          </View>
          {p.error ? (
            <Text variant="label" color="danger" accessibilityRole="alert">
              {p.error}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  thread: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  replyRow: { marginLeft: space.xl, paddingLeft: space.sm, borderLeftWidth: 2, borderLeftColor: colors.line },
  main: { flex: 1, gap: 2, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { flexShrink: 1 },
  pill: { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  text: { lineHeight: 22 },
  actions: { flexDirection: 'row', gap: space.lg },
  action: { minHeight: 48, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  deleted: { fontStyle: 'italic' },
  composer: { gap: space.sm },
  replyingTo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  cancel: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  input: {
    minHeight: 48,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
