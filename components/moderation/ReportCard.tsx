/**
 * One report row in the moderation list: reason + relative time + reporter,
 * the target (listing thumbnail+title, or user name) tappable to its detail
 * screen, optional details text, and (for open reports) the action row.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, radius, space } from '@/constants/theme';
import { resolveMediaUrl } from '@/lib/trpc';
import { formatRelative } from '@/utils/format';
import type { ModerationReport } from '@/types';

const REASON_LABELS: Record<ModerationReport['reason'], string> = {
  prohibited_item: 'Prohibited item',
  scam: 'Scam or dishonest listing',
  harassment: 'Harassment',
  no_show: 'Did not show up',
  other: 'Something else',
};

export interface ReportCardProps {
  report: ModerationReport;
  onPressTarget: () => void;
  /** Omit to render without the open-report action row (reviewed reports). */
  actions?: {
    dismissing: boolean;
    removing: boolean;
    onDismiss: () => void;
    onRemoveListing: () => void;
    /** Shown only for community-post reports. */
    removingPost?: boolean;
    onRemovePost?: () => void;
    onAddNote: () => void;
  };
}

export function ReportCard({ report, onPressTarget, actions }: ReportCardProps) {
  const hasListing = !!report.targetListing;
  const isPost = !!report.targetPostId && !hasListing;
  const targetLabel = hasListing
    ? report.targetListing!.title
    : isPost
      ? `Community post by ${report.targetUser?.displayName ?? 'a deleted account'}`
      : (report.targetUser?.displayName ?? 'Deleted account');

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text variant="label" weight="600" color="ink">
          {REASON_LABELS[report.reason]}
        </Text>
        <Text variant="caption" color="inkFaint">
          {formatRelative(report.createdAt)}
        </Text>
      </View>

      <Text variant="caption" color="inkMuted">
        Reported by {report.reporter.displayName}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${hasListing ? 'listing' : 'profile'}: ${targetLabel}`}
        onPress={onPressTarget}
        style={({ pressed }) => [styles.targetRow, pressed && styles.pressed]}
      >
        {hasListing ? (
          <Image
            source={{ uri: resolveMediaUrl(report.targetListing!.coverPhotoUrl) }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        <Text variant="body" weight="600" style={styles.targetLabel} numberOfLines={1}>
          {targetLabel}
        </Text>
      </Pressable>

      {report.targetPost ? (
        <View style={styles.postBox}>
          <View style={styles.headerRow}>
            <Text variant="caption" weight="600" color="inkMuted">
              {report.targetPost.kind === 'buying' ? 'Looking to buy' : 'Selling'}
            </Text>
            {report.targetPost.removedAt ? (
              <Text variant="caption" weight="600" color="danger">
                Removed
              </Text>
            ) : null}
          </View>
          <Text variant="body" color="inkMuted" numberOfLines={6}>
            {`“${report.targetPost.body}”`}
          </Text>
        </View>
      ) : null}

      {report.details ? (
        <Text variant="body" color="inkMuted" style={styles.details}>
          {report.details}
        </Text>
      ) : null}

      {report.status === 'reviewed' ? (
        <View style={styles.reviewedNote}>
          <Text variant="caption" color="inkFaint">
            {report.moderatorNote ? `Note: ${report.moderatorNote}` : 'No note left.'}
          </Text>
        </View>
      ) : null}

      {actions ? (
        <View style={styles.actionsRow}>
          <Button
            title="Dismiss"
            variant="secondary"
            size="md"
            onPress={actions.onDismiss}
            loading={actions.dismissing}
            style={styles.actionBtn}
          />
          {hasListing ? (
            <Button
              title="Remove listing"
              variant="danger"
              size="md"
              onPress={actions.onRemoveListing}
              loading={actions.removing}
              style={styles.actionBtn}
            />
          ) : null}
          {isPost && actions.onRemovePost ? (
            <Button
              title="Remove post"
              variant="danger"
              size="md"
              onPress={actions.onRemovePost}
              loading={actions.removingPost}
              style={styles.actionBtn}
            />
          ) : null}
          <Button
            title="Add note"
            variant="ghost"
            size="md"
            onPress={actions.onAddNote}
            style={styles.actionBtn}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: space.sm,
  },
  pressed: { opacity: 0.7 },
  thumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.line },
  targetLabel: { flex: 1 },
  details: { marginTop: -space.xs },
  postBox: { gap: space.xs, borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: space.sm },
  reviewedNote: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: space.sm,
  },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  actionBtn: { flexGrow: 1 },
});

export default ReportCard;
