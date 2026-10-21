/**
 * The buyer's own offer state on a listing, from `offer.forListing`.
 * pending  -> "Offer sent: $X — waiting for the seller" + Withdraw
 * accepted -> "Seller accepted $X — book a time before <time>" + Book
 * declined / expired / withdrawn -> a plain note; a new offer is allowed.
 * heldByOther -> another buyer's accepted offer holds the item.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { colors, radius, space } from '@/constants/theme';
import { clockTime, relativeDayLabel } from '@/components/booking/time';
import { formatPrice } from '@/utils/format';
import type { ListingOffers } from '@/types';

export interface BuyerOfferCardProps {
  data: ListingOffers;
  timeZone?: string;
  withdrawing: boolean;
  onWithdraw: (offerId: string) => void;
  onBook: (offerId: string, amountCents: number) => void;
}

export function BuyerOfferCard({ data, timeZone, withdrawing, onWithdraw, onBook }: BuyerOfferCardProps) {
  const latest = data.offers[0];

  if (data.heldByOther) {
    return (
      <Box tone="warning">
        <Text variant="body">Another buyer&apos;s offer was accepted; this may open up again.</Text>
      </Box>
    );
  }
  if (!latest) return null;

  const amount = formatPrice(latest.amountCents);

  if (latest.status === 'pending') {
    return (
      <Box tone="neutral">
        <Text variant="body" weight="600">
          Offer sent: {amount} — waiting for the seller
        </Text>
        <Button
          title="Withdraw offer"
          variant="secondary"
          onPress={() => onWithdraw(latest.id)}
          loading={withdrawing}
          accessibilityLabel={`Withdraw your ${amount} offer`}
        />
      </Box>
    );
  }

  if (latest.status === 'accepted' && data.heldByViewer && data.heldUntil) {
    const until = new Date(data.heldUntil);
    return (
      <Box tone="success">
        <Text variant="body" weight="600">
          Seller accepted {amount} — book a time before {relativeDayLabel(until, timeZone)} {clockTime(until, timeZone)}
        </Text>
        <Button
          title={`Book at ${amount}`}
          onPress={() => onBook(latest.id, latest.amountCents)}
          accessibilityLabel={`Book a meetup at the accepted price of ${amount}`}
        />
        <Button
          title="Release the hold"
          variant="ghost"
          onPress={() => onWithdraw(latest.id)}
          loading={withdrawing}
        />
      </Box>
    );
  }

  if (latest.status === 'declined' || latest.status === 'expired' || latest.status === 'withdrawn') {
    const copy =
      latest.status === 'declined'
        ? `Your ${amount} offer was declined. You can make a new offer or book at the asking price.`
        : latest.status === 'expired'
          ? `Your ${amount} offer expired. You can make a new offer or book at the asking price.`
          : `You withdrew your ${amount} offer.`;
    return (
      <Box tone="neutral">
        <Text variant="body" color="inkMuted">
          {copy}
        </Text>
      </Box>
    );
  }

  return null;
}

function Box({ tone, children }: { tone: 'neutral' | 'success' | 'warning'; children: React.ReactNode }) {
  const bg = tone === 'success' ? colors.successSoft : tone === 'warning' ? colors.warningSoft : colors.surfaceMuted;
  return (
    <View style={[styles.box, { backgroundColor: bg }]} accessibilityRole="summary">
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.md, gap: space.sm, marginTop: space.lg },
});

export default BuyerOfferCard;
