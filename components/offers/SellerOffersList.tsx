/**
 * Seller's view of offers on their listing: buyer, amount vs asking, note, the
 * meetup the buyer proposed (if any), status, hold expiry, and Accept /
 * Decline for pending offers. Accepting an offer that proposes a meetup books
 * that exact time and spot.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { clockTime, relativeDayLabel } from '@/components/booking/time';
import { space } from '@/constants/theme';
import { formatPrice } from '@/utils/format';
import type { ListingOffers } from '@/types';

type Offer = ListingOffers['offers'][number];

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Waiting for you', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  booked: { label: 'Booked', tone: 'success' },
};

export interface SellerOffersListProps {
  offers: Offer[];
  timeZone?: string;
  busyId?: string | null;
  onAccept: (offer: Offer) => void;
  onDecline: (offer: Offer) => void;
}

export function SellerOffersList({ offers, timeZone, busyId, onAccept, onDecline }: SellerOffersListProps) {
  if (offers.length === 0) {
    return (
      <Text variant="body" color="inkMuted">
        No offers yet. Buyers can still book your asking price at any open time.
      </Text>
    );
  }
  return (
    <View style={styles.list}>
      {offers.map((o) => {
        const s = STATUS[o.status] ?? { label: o.status, tone: 'neutral' as BadgeTone };
        const hold = o.status === 'accepted' && o.holdExpiresAt ? new Date(o.holdExpiresAt) : null;
        return (
          <Card key={o.id} style={styles.card}>
            <View style={styles.head}>
              <Avatar uri={o.buyer.avatarUrl} name={o.buyer.displayName} size={32} />
              <View style={styles.headText}>
                <Text variant="label" weight="600" numberOfLines={1}>
                  {o.buyer.displayName}
                </Text>
                <Text variant="caption" color="inkMuted">
                  Offered {formatPrice(o.amountCents)} on {formatPrice(o.askingPriceCents)} asking
                </Text>
              </View>
              <Badge kind="status" label={s.label} tone={s.tone} />
            </View>
            {o.message ? (
              <Text variant="body" color="inkMuted">
                &ldquo;{o.message}&rdquo;
              </Text>
            ) : null}
            {o.proposedStartsAt ? (
              <Text variant="caption" color="inkMuted">
                Proposed meetup: {relativeDayLabel(o.proposedStartsAt, timeZone)}{' '}
                {clockTime(o.proposedStartsAt, timeZone)}
                {o.proposedSpot ? ` at ${o.proposedSpot.name}` : ''}
                {o.status === 'pending' ? ' — accepting books this time.' : ''}
              </Text>
            ) : null}
            {hold ? (
              <Text variant="caption" color="inkMuted">
                Held for this buyer until {relativeDayLabel(hold, timeZone)} {clockTime(hold, timeZone)}. They book the
                time.
              </Text>
            ) : null}
            {o.status === 'pending' ? (
              <View style={styles.actions}>
                <Button
                  title="Accept"
                  onPress={() => onAccept(o)}
                  loading={busyId === o.id}
                  style={styles.actionBtn}
                  accessibilityLabel={`Accept ${formatPrice(o.amountCents)} offer from ${o.buyer.displayName}`}
                />
                <Button
                  title="Decline"
                  variant="secondary"
                  onPress={() => onDecline(o)}
                  disabled={busyId === o.id}
                  style={styles.actionBtn}
                  accessibilityLabel={`Decline ${formatPrice(o.amountCents)} offer from ${o.buyer.displayName}`}
                />
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  card: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1 },
  actions: { flexDirection: 'row', gap: space.sm },
  actionBtn: { flex: 1 },
});

export default SellerOffersList;
