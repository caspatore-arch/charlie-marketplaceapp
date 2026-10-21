/**
 * Booking flow (route `/reservation/request?listingId=&offerId=&offerCents=`).
 *
 *   1. Pick an open 30-minute time (slot chart, campus timezone)
 *   2. Pick a campus meetup place
 *   3. Confirm: exact price, exact local time + date, place -> `reservation.book`
 *
 * Booking is final at once (no seller approval step). On CONFLICT the server's
 * message is shown and the slot chart is refetched, because availability was
 * stale. The fee breakdown is simulated and says so.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { PriceText } from '@/components/ui/PriceText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { SpotPicker } from '@/components/SpotPicker';
import { TimeSlotPicker } from '@/components/TimeSlotPicker';
import { FeeBreakdown } from '@/components/FeeBreakdown';
import { ServerErrorNote, type ServerErrorLike } from '@/components/offers/ServerErrorNote';
import { clockTime, exactMeetupTime, relativeDayLabel, zoneAbbreviation } from '@/components/booking/time';
import { trpc, resolveMediaUrl } from '@/lib/trpc';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { colors, radius, space } from '@/constants/theme';
import { formatPrice } from '@/utils/format';

export default function BookingScreen() {
  const { listingId, offerId: offerIdParam, offerCents: offerCentsParam } = useLocalSearchParams<{
    listingId: string;
    offerId?: string;
    offerCents?: string;
  }>();
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const requireAuth = useRequireAuth();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [startsAt, setStartsAt] = useState<string | undefined>();
  const [spotId, setSpotId] = useState<string | undefined>();
  const [error, setError] = useState<ServerErrorLike | null>(null);

  useEffect(() => {
    if (authStatus === 'signedOut' && listingId) requireAuth(`/reservation/request?listingId=${listingId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  const listingQuery = trpc.listing.byId.useQuery({ id: listingId! }, { enabled: !!listingId });
  const slotsQuery = trpc.reservation.slots.useQuery({ listingId: listingId! }, { enabled: !!listingId });
  const offersQuery = trpc.offer.forListing.useQuery(
    { listingId: listingId! },
    { enabled: !!listingId && authStatus === 'signedIn' },
  );

  const listing = listingQuery.data;
  const chart = slotsQuery.data;
  const timeZone = chart?.timezone;

  // The viewer's accepted, still-held offer sets the price (the server does the
  // same). Until the offers load, fall back to what the listing screen passed.
  const heldOffer = offersQuery.data?.heldByViewer
    ? offersQuery.data.offers.find((o) => o.status === 'accepted')
    : undefined;
  const offerLoading = !!offerIdParam && offersQuery.isPending && authStatus === 'signedIn';
  const paramCents = offerCentsParam ? Number.parseInt(offerCentsParam, 10) : NaN;
  const offerLost = !!offerIdParam && offersQuery.isSuccess && !heldOffer;
  const priceCents = heldOffer
    ? heldOffer.amountCents
    : !offersQuery.isSuccess && offerIdParam && Number.isFinite(paramCents)
      ? paramCents
      : (listing?.priceCents ?? 0);
  const offerId = heldOffer?.id ?? (offersQuery.isSuccess ? undefined : offerIdParam);
  const isAgreedOffer = !!offerId && priceCents !== listing?.priceCents;

  const quoteQuery = trpc.payment.quote.useQuery({ priceCents }, { enabled: step === 'confirm' && priceCents > 0 });

  const spots = chart?.spots ?? [];
  const selectedSpot = spots.find((s) => s.id === spotId);
  const selectedSlot = chart?.slots.find((s) => new Date(s.startsAt).toISOString() === startsAt);
  // If a refetch shows the chosen time is gone, treat it as unselected.
  const pickedStart = selectedSlot?.available ? startsAt : undefined;

  const bookMutation = trpc.reservation.book.useMutation({
    onSuccess: async (res) => {
      await Promise.all([
        utils.reservation.mine.invalidate(),
        utils.reservation.slots.invalidate({ listingId: listingId! }),
        utils.offer.forListing.invalidate({ listingId: listingId! }),
        utils.offer.mine.invalidate(),
        utils.listing.byId.invalidate({ id: listingId! }),
        utils.listing.feed.invalidate(),
      ]);
      router.replace(`/reservation/${res.id}`);
    },
    onError: (err) => {
      setError(err);
      if (err.data?.code === 'CONFLICT') {
        // Stale availability: show the message, refresh, send them back to pick again.
        setStep('pick');
        utils.reservation.slots.invalidate({ listingId: listingId! });
        utils.offer.forListing.invalidate({ listingId: listingId! });
        utils.listing.byId.invalidate({ id: listingId! });
      }
    },
  });

  const review = useCallback(() => {
    if (!pickedStart || !spotId) return;
    setError(null);
    setStep('confirm');
  }, [pickedStart, spotId]);

  const confirm = useCallback(() => {
    if (!listingId || !pickedStart || !spotId) return;
    setError(null);
    bookMutation.mutate({
      listingId,
      spotId,
      startsAt: new Date(pickedStart),
      offerId,
      expectedPriceCents: priceCents,
    });
  }, [bookMutation, listingId, offerId, priceCents, spotId, pickedStart]);

  const header = useMemo(
    () =>
      listing ? (
        <View style={styles.itemRow}>
          <Image
            source={{ uri: resolveMediaUrl(listing.photos[0]?.url) }}
            style={styles.thumb}
            contentFit="cover"
            accessibilityLabel={`Photo of ${listing.title}`}
          />
          <View style={styles.itemInfo}>
            <Text variant="heading" numberOfLines={2}>
              {listing.title}
            </Text>
            <PriceText cents={priceCents} />
            <Text variant="caption" color="inkMuted">
              {isAgreedOffer
                ? `Agreed offer (asking ${formatPrice(listing.priceCents)})`
                : 'Asking price'}
            </Text>
          </View>
        </View>
      ) : null,
    [listing, priceCents, isAgreedOffer],
  );

  if (listingQuery.isPending || slotsQuery.isPending || offerLoading) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Book a meetup' }} />
        <View style={styles.gap}>
          <Skeleton height={72} />
          <Skeleton height={160} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }

  if (listingQuery.isError || slotsQuery.isError || !listing || !chart) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Book a meetup' }} />
        <ErrorState
          message={listingQuery.error?.message ?? slotsQuery.error?.message ?? 'Could not load this listing.'}
          onRetry={() => {
            listingQuery.refetch();
            slotsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  if (!chart.open) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: 'Book a meetup' }} />
        {header}
        <EmptyState
          title="Can't book this one"
          body={chart.closedReason ?? 'This item is no longer available.'}
          actionLabel="Back to listing"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const anyAvailable = chart.slots.some((s) => s.available);
  const zone = zoneAbbreviation(timeZone);

  if (step === 'confirm' && pickedStart && selectedSpot) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: 'Confirm booking' }} />
        <Text variant="title">Confirm your meetup</Text>
        <Card style={styles.gap}>
          {header}
          <Divider />
          <SummaryRow label="When" value={exactMeetupTime(pickedStart, timeZone, chart.slotMinutes * 60_000)} sub={zone ? `Campus time (${zone})` : undefined} />
          <SummaryRow label="Where" value={selectedSpot.name} sub={selectedSpot.description} />
          <SummaryRow
            label="Price"
            value={formatPrice(priceCents)}
            sub={isAgreedOffer ? 'Agreed offer' : 'Asking price'}
          />
        </Card>

        {quoteQuery.data ? <FeeBreakdown quote={quoteQuery.data} /> : <Skeleton height={80} radius={14} />}
        <Text variant="caption" color="inkMuted">
          Simulated — no money moves. You pay the seller in person or as you both agree.
        </Text>

        <ServerErrorNote error={error} />
        <Button title="Confirm booking" size="lg" onPress={confirm} loading={bookMutation.isPending} />
        <Button title="Change time or place" variant="ghost" onPress={() => setStep('pick')} disabled={bookMutation.isPending} />
      </Screen>
    );
  }

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Book a meetup' }} />
      {header}

      {offerLost ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text variant="body">
            Your accepted offer is no longer on hold, so this books at the asking price of {formatPrice(listing.priceCents)}.
          </Text>
        </View>
      ) : null}

      <ServerErrorNote error={error} />

      <View style={styles.section}>
        <Text variant="title">Pick a time</Text>
        <Text variant="caption" color="inkMuted">
          30-minute meetups in campus time{zone ? ` (${zone})` : ''}.
          {chart.expiresAt
            ? ` Listing is live until ${relativeDayLabel(chart.expiresAt, timeZone)} ${clockTime(chart.expiresAt, timeZone)}.`
            : ''}
        </Text>
        {chart.slots.length === 0 || !anyAvailable ? (
          <EmptyState
            title="No open times"
            body="No open times — message the seller."
            actionLabel="Back to listing"
            onAction={() => router.back()}
          />
        ) : null}
        {chart.slots.length > 0 ? (
          <TimeSlotPicker slots={chart.slots} timeZone={timeZone} selectedIso={pickedStart} onSelect={setStartsAt} />
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="title">Pick a place</Text>
        {spots.length === 0 ? (
          <Text variant="body" color="inkMuted">
            The seller has no active campus meetup places on this listing. Message the seller.
          </Text>
        ) : (
          <SpotPicker spots={spots} selectedId={spotId} onSelect={setSpotId} />
        )}
      </View>

      <Button
        title="Review booking"
        size="lg"
        onPress={review}
        disabled={!pickedStart || !spotId}
        accessibilityLabel={!pickedStart || !spotId ? 'Review booking. Pick a time and a place first.' : 'Review booking'}
      />
      <Button title="Back" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function SummaryRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.summaryRow} accessible accessibilityLabel={`${label}: ${value}${sub ? `. ${sub}` : ''}`}>
      <Text variant="caption" color="inkMuted">
        {label}
      </Text>
      <Text variant="heading">{value}</Text>
      {sub ? (
        <Text variant="caption" color="inkMuted">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl, paddingBottom: space.huge },
  gap: { gap: space.md },
  section: { gap: space.md },
  itemRow: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  itemInfo: { flex: 1, gap: 2 },
  summaryRow: { gap: 2 },
  notice: { backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: space.md },
});
