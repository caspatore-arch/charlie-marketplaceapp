/**
 * One request in the buying-team queue: cover, item, seller, plain-words status,
 * how long it has been waiting, and a "Needs action" marker.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { colors, minTouchHeight, radius, shadow, space } from '@/constants/theme';
import { resolveMediaUrl } from '@/lib/trpc';
import { estimateText, formatCents, formatWhen, isOpenStatus, statusText, statusTone, waitingText, type StaffQueueRow } from './format';

export function QueueRow({ row, onPress }: { row: StaffQueueRow; onPress: () => void }) {
  const open = isOpenStatus(row.status);
  const cover = resolveMediaUrl(row.coverUrl);
  const status = statusText(row.status, row.meetupProposedBy);
  const estimate = estimateText(row.estimateLowCents, row.estimateHighCents);
  const timing = open
    ? `Submitted ${formatWhen(row.createdAt)} · waiting ${waitingText(row.waitingMinutes)}`
    : `Submitted ${formatWhen(row.createdAt)} · updated ${formatWhen(row.updatedAt)}`;

  const label = [
    row.itemName,
    `from ${row.sellerName}`,
    status,
    row.staffActionNeeded ? 'needs action' : null,
    open ? `waiting ${waitingText(row.waitingMinutes)}` : null,
    row.listingId ? 'public listing' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, row.staffActionNeeded && styles.rowAction, pressed && styles.pressed]}
    >
      <View style={styles.thumb}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.thumbImg} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <ImageOff size={22} color={colors.inkFaint} />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {row.itemName}
          </Text>
        </View>
        <Text variant="label" color="inkMuted" numberOfLines={1}>
          {row.sellerName}
        </Text>
        <Text variant="label" weight="600">
          {status}
        </Text>
        <Text variant="caption" color="inkMuted">
          {timing}
        </Text>
        {estimate || row.finalOfferCents != null ? (
          <Text variant="caption" color="inkMuted">
            {[estimate ? `Estimate ${estimate}` : null, row.finalOfferCents != null ? `Final offer ${formatCents(row.finalOfferCents)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        <View style={styles.badges}>
          {row.staffActionNeeded ? <Badge kind="status" label="Needs action" tone="warning" /> : null}
          {row.listingId ? <Badge kind="status" label="Public listing" tone="neutral" /> : null}
          {!open ? <Badge kind="status" label="Closed" tone={statusTone(row.status)} /> : null}
          {row.assignedStaffName ? <Badge kind="status" label={`Reviewing: ${row.assignedStaffName}`} tone="success" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    minHeight: minTouchHeight,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'transparent',
    ...shadow,
  },
  rowAction: { borderColor: colors.warning },
  pressed: { opacity: 0.9 },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
});

export default QueueRow;
