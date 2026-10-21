/**
 * One row in Meetups & messages > Offers. Shows the listing thumb + title, the
 * offered amount against the asking price, the other person, and a status pill.
 * A seller's pending offers also get Accept / Decline buttons.
 * Usage: <OfferRow offer={o} viewerId={user.id} onPress={...} onAccept={...} onDecline={...} />
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, space } from '@/constants/theme';
import { Text } from '../ui/Text';
import { Badge, type BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { resolveMediaUrl } from '@/lib/trpc';
import { formatPrice, formatRelative } from '@/utils/format';
import type { OfferWithContext } from '@/types';

const STATUS: Record<OfferWithContext['status'], { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  booked: { label: 'Booked', tone: 'success' },
};

export interface OfferRowProps {
  offer: OfferWithContext;
  viewerId: string;
  onPress: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  busy?: boolean;
}

export function OfferRow({ offer, viewerId, onPress, onAccept, onDecline, busy = false }: OfferRowProps) {
  const isSeller = offer.sellerId === viewerId;
  const other = isSeller ? offer.buyer : offer.seller;
  const title = offer.listing?.title ?? 'Item no longer available';
  const asking = offer.listing ? formatPrice(offer.listing.priceCents) : null;
  const status = STATUS[offer.status];
  const canRespond = isSeller && offer.status === 'pending' && !!onAccept && !!onDecline;

  return (
    <View style={[styles.wrap, canRespond && styles.wrapEmphasis]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isSeller ? 'Offer from' : 'Your offer to'} ${other.displayName} on ${title}, ${formatPrice(offer.amountCents)}${asking ? ` against ${asking} asking` : ''}, ${status.label}`}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {offer.listing ? (
          <Image
            source={{ uri: resolveMediaUrl(offer.listing.coverPhotoUrl) }}
            style={styles.thumb}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={styles.thumb} />
        )}
        <View style={styles.info}>
          <View style={styles.topLine}>
            <Text variant="label" weight="600" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <Badge kind="status" label={status.label} tone={status.tone} />
          </View>
          <Text variant="body" weight="600">
            {formatPrice(offer.amountCents)}
            {asking ? (
              <Text variant="caption" color="inkMuted">{`  vs ${asking} asking`}</Text>
            ) : null}
          </Text>
          <Text variant="caption" color="inkMuted" numberOfLines={1}>
            {isSeller ? 'From' : 'To'} {other.displayName} · {formatRelative(offer.createdAt)}
          </Text>
        </View>
      </Pressable>
      {canRespond ? (
        <View style={styles.actions}>
          <Button title="Accept" size="md" onPress={onAccept!} loading={busy} style={styles.action} />
          <Button title="Decline" size="md" variant="secondary" onPress={onDecline!} disabled={busy} style={styles.action} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.md, paddingHorizontal: space.sm },
  wrapEmphasis: { backgroundColor: colors.accentSoft, marginVertical: space.xs },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  pressed: { opacity: 0.85 },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  info: { flex: 1, gap: 2, justifyContent: 'center' },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: space.sm, paddingBottom: space.md },
  action: { flex: 1 },
});

export default OfferRow;
