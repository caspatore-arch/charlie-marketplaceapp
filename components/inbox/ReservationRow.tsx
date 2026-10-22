/**
 * One row in the Inbox > Meetups list.
 * Usage: <ReservationRow reservation={r} viewerId={user.id} onPress={() => router.push(`/reservation/${r.id}`)} />
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from '../ui/Text';
import { Badge } from '../ui/Badge';
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
  const [imageFailed, setImageFailed] = useState(false);
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
      {imageFailed || !reservation.listing.coverPhotoUrl ? (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <ImageOff size={20} color={colors.inkFaint} />
        </View>
      ) : (
        <Image
          source={{ uri: resolveMediaUrl(reservation.listing.coverPhotoUrl) }}
          style={styles.thumb}
          contentFit="cover"
          transition={150}
          onError={() => setImageFailed(true)}
        />
      )}
      <View style={styles.info}>
        <Text variant="label" weight="600" numberOfLines={2}>
          {reservation.listing.title}
        </Text>
        <View style={styles.pillLine}>
          <ReservationStatusPill status={reservation.status} />
          {reservation.seller.isDemo ? <Badge kind="demo" /> : null}
        </View>
        <Text variant="caption" color="inkMuted" numberOfLines={1}>
          {role === 'seller' ? 'Selling to' : 'Buying from'} {otherParty.displayName} · {reservation.spot?.name ?? 'Custom address'}
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
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  pillLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginVertical: 2 },
  needsReply: { marginTop: 2 },
});

export default ReservationRow;
