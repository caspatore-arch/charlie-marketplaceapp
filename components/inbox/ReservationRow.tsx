/**
 * One row in the Inbox > Requests list (grouped "As buyer" / "As seller").
 * Usage: <ReservationRow reservation={r} viewerId={user.id} onPress={() => router.push(`/reservation/${r.id}`)} />
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, space } from '@/constants/theme';
import { Text } from '../ui/Text';
import { ReservationStatusPill } from '../ReservationStatusPill';
import { resolveMediaUrl } from '@/lib/trpc';
import { formatMeetupTime } from '@/utils/format';
import type { ReservationDetail } from '@/types';

export interface ReservationRowProps {
  reservation: ReservationDetail;
  viewerId: string;
  role: 'buyer' | 'seller';
  onPress: () => void;
}

export function ReservationRow({ reservation, viewerId, role, onPress }: ReservationRowProps) {
  const otherParty = role === 'buyer' ? reservation.seller : reservation.buyer;
  const needsReply =
    (reservation.status === 'requested' || reservation.status === 'countered') &&
    reservation.proposedById !== viewerId;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reservation.listing.title}, meetup with ${otherParty.displayName}, status ${reservation.status}${needsReply ? ', needs your reply' : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, needsReply && styles.rowEmphasis, pressed && styles.pressed]}
    >
      <Image
        source={{ uri: resolveMediaUrl(reservation.listing.coverPhotoUrl) }}
        style={styles.thumb}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.info}>
        <View style={styles.topLine}>
          <Text variant="label" weight="600" numberOfLines={1} style={styles.title}>
            {reservation.listing.title}
          </Text>
          <ReservationStatusPill status={reservation.status} />
        </View>
        <Text variant="caption" color="inkMuted" numberOfLines={1}>
          {otherParty.displayName} · {reservation.spot?.name ?? 'Custom address'}
        </Text>
        <Text variant="caption" color="inkFaint" numberOfLines={1}>
          {formatMeetupTime(reservation.startsAt.toISOString())}
        </Text>
        {needsReply ? (
          <Text variant="caption" weight="600" color="accent" style={styles.needsReply}>
            Needs your reply
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  rowEmphasis: { backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.85 },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  info: { flex: 1, gap: 2, justifyContent: 'center' },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { flexShrink: 1 },
  needsReply: { marginTop: 2 },
});

export default ReservationRow;
