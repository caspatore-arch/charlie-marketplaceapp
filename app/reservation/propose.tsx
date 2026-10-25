/**
 * Propose a meetup on an ARCHIVED listing (route `/reservation/propose?listingId=`).
 *
 * A listing lives in Browse for 24 hours, then moves to the Archive. It stays
 * usable: the BUYER proposes a time and a place, and the SELLER accepts or
 * declines (the seller's side is the normal meetup screen, `/reservation/[id]`).
 *
 *   1. Pick a day and a 15-minute time (campus time, next 7 days, 7 AM - 11 PM)
 *   2. Pick a campus meetup place, or check another address
 *   3. Confirm in plain words -> `reservation.request` (creates a `requested` meetup)
 *   4. Done: "Request sent". Nothing is booked until the seller accepts.
 *
 * Live listings keep their own flow (`/reservation/request`, `reservation.book`).
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
import { DemoBadge } from '@/components/DemoBadge';
import { SpotPicker, type ResolvedCustomAddress } from '@/components/SpotPicker';
import { ProposalTimePicker } from '@/components/reservation/ProposalTimePicker';
import { ServerErrorNote, type ServerErrorLike } from '@/components/offers/ServerErrorNote';
import {
  clockTime,
  exactMeetupTime,
  proposalSlotStarts,
  relativeDayLabel,
  shortDate,
  zoneAbbreviation,
} from '@/components/booking/time';
import { trpc, resolveMediaUrl } from '@/lib/trpc';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { colors, radius, space } from '@/constants/theme';

interface SentSummary {
  sellerName: string;
}

/** "today (Sun, Oct 25) at 3:00 PM MST" / "on Tue, Oct 27 at 3:00 PM MST" for the confirm sentence. */
function whenPhrase(iso: string, timeZone?: string): string {
  const day = relativeDayLabel(iso, timeZone);
  const date = shortDate(iso, timeZone);
  const zone = zoneAbbreviation(timeZone);
  const dayPart = day === 'Today' || day === 'Tomorrow' ? `${day.toLowerCase()} (${date})` : `on ${date}`;
  return `${dayPart} at ${clockTime(iso, timeZone)}${zone ? ` ${zone}` : ''}`;
}

export default function ProposeMeetupScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const router = useRouter();
  const { status: authStatus, user } = useAuth();
  const requireAuth = useRequireAuth();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<'pick' | 'confirm' | 'done'>('pick');
  const [startsAt, setStartsAt] = useState<string | undefined>();
  const [spotId, setSpotId] = useState<string | undefined>();
  const [customAddress, setCustomAddress] = useState<ResolvedCustomAddress | null>(null);
  const [error, setError] = useState<ServerErrorLike | null>(null);
  const [sent, setSent] = useState<SentSummary | null>(null);
  // Fixed when the screen opens, so the render stays free of Date.now() and the
  // list of times does not shift while the buyer is choosing.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    if (authStatus === 'signedOut' && listingId) {
      requireAuth(`/reservation/propose?listingId=${encodeURIComponent(listingId)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  const listingQuery = trpc.listing.byId.useQuery({ id: listingId! }, { enabled: !!listingId });
  const listing = listingQuery.data;
  const campusesQuery = trpc.campus.list.useQuery();
  const campusZone = campusesQuery.data?.find((c) => c.id === listing?.campusId)?.timezone;
  // Fallback only: the slot chart carries the campus zone too.
  const slotsQuery = trpc.reservation.slots.useQuery(
    { listingId: listingId! },
    { enabled: !!listingId && !!listing && campusesQuery.isSuccess && !campusZone },
  );
  const timeZone = campusZone ?? slotsQuery.data?.timezone;
  const spotsQuery = trpc.campus.spots.useQuery({ campusId: listing?.campusId ?? '' }, { enabled: !!listing });
  const spots = useMemo(() => spotsQuery.data ?? [], [spotsQuery.data]);

  const starts = useMemo(() => (timeZone ? proposalSlotStarts(timeZone, new Date(openedAt)) : []), [timeZone, openedAt]);
  const selectedSpot = spots.find((s) => s.id === spotId);
  // A pick that is no longer on offer (e.g. the screen sat open) counts as unpicked.
  const pickedStart = startsAt && starts.some((d) => d.toISOString() === startsAt) ? startsAt : undefined;
  const placeReady = !!customAddress || !!selectedSpot;
  const placeName = customAddress ? customAddress.address : (selectedSpot?.name ?? '');

  const requestMutation = trpc.reservation.request.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.reservation.mine.invalidate(),
        utils.reservation.forListing.invalidate({ listingId: listingId! }),
        utils.listing.byId.invalidate({ id: listingId! }),
      ]);
      setSent({ sellerName: listing?.seller.displayName ?? 'The seller' });
      setStep('done');
    },
    onError: (err) => {
      setError(err);
      // A time or place the server refused: go back to pick again. Other errors
      // (an open request already, blocked, campus email) stay on the confirm step.
      if (err.data?.code === 'BAD_REQUEST') setStep('pick');
    },
  });

  const goToListing = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/listing/${listingId}`);
  }, [router, listingId]);

  const review = useCallback(() => {
    if (!pickedStart || !placeReady) return;
    if (new Date(pickedStart).getTime() <= Date.now()) {
      setStartsAt(undefined);
      setError({ message: 'That time has already passed. Pick a later one.', data: { code: 'BAD_REQUEST' } });
      return;
    }
    setError(null);
    setStep('confirm');
  }, [pickedStart, placeReady]);

  const confirm = useCallback(() => {
    if (!listingId || !pickedStart || !placeReady) return;
    setError(null);
    requestMutation.mutate({
      listingId,
      startsAt: new Date(pickedStart),
      ...(customAddress ? { customAddress: customAddress.address } : { spotId: selectedSpot!.id }),
    });
  }, [requestMutation, listingId, pickedStart, placeReady, customAddress, selectedSpot]);

  const title = 'Propose a meetup';

  // ---- Done
  if (step === 'done' && sent) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: 'Request sent', headerBackVisible: false, gestureEnabled: false }} />
        <Text variant="title" accessibilityRole="header">
          Request sent
        </Text>
        <Card style={styles.gap}>
          <Text variant="body">
            {sent.sellerName} will be notified and can accept or decline. Nothing is booked until they accept.
          </Text>
          <Text variant="body" color="inkMuted">
            You&apos;ll see their answer in your inbox. If they accept, you pay the seller in person when you meet.
            Dibbs never handles money.
          </Text>
        </Card>
        <Button title="Go to inbox" size="lg" onPress={() => router.replace('/inbox')} />
        <Button title="Back to listing" variant="secondary" onPress={goToListing} />
      </Screen>
    );
  }

  // ---- Loading / errors
  if (!listingId) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState title="No listing chosen" body="Open a listing and tap Propose a time and place." actionLabel="Back" onAction={() => router.back()} />
      </Screen>
    );
  }

  if (authStatus === 'loading' || authStatus === 'signedOut' || listingQuery.isPending) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title }} />
        <View style={styles.gap}>
          <Skeleton height={72} />
          <Skeleton height={160} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }

  if (listingQuery.isError || !listing) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorState message={listingQuery.error?.message ?? 'Could not load this listing.'} onRetry={() => listingQuery.refetch()} />
      </Screen>
    );
  }

  const header = (
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
        <PriceText cents={listing.priceCents} />
        <Text variant="caption" color="inkMuted">
          Asking price
        </Text>
      </View>
    </View>
  );

  // ---- Only an archived listing can be proposed on
  const isOwn = listing.viewerRole === 'seller' || listing.seller.id === user?.id;
  const archived =
    listing.saleType !== 'auction' &&
    (listing.status === 'expired' ||
      (listing.status === 'active' && !!listing.expiresAt && new Date(listing.expiresAt).getTime() <= openedAt));
  if (isOwn || !archived) {
    const why = isOwn
      ? {
          title: "You can't request your own listing",
          body: 'Buyers propose a time and place on archived listings, and you accept or decline. To sell it again, relist it from Edit listing.',
        }
      : listing.status === 'active'
        ? {
            title: 'This listing is still live',
            body: "It's still on Browse, so book one of the seller's open times from the listing instead.",
          }
        : listing.status === 'reserved'
          ? { title: 'This item is reserved', body: 'Another buyer already has a confirmed meetup for it.' }
          : listing.status === 'sold'
            ? { title: 'This item was sold', body: "It's gone, so there's nothing left to ask for." }
            : { title: 'This listing is no longer available', body: 'It was removed.' };
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title }} />
        {header}
        <EmptyState title={why.title} body={why.body} actionLabel="Back to listing" onAction={goToListing} />
      </Screen>
    );
  }

  const zone = zoneAbbreviation(timeZone);

  // ---- Confirm
  if (step === 'confirm' && pickedStart && placeReady) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: 'Confirm request' }} />
        <Text variant="title" accessibilityRole="header">
          Confirm your request
        </Text>
        <Card style={styles.gap}>
          {header}
          <Divider />
          <Text variant="heading">
            {`You're asking ${listing.seller.displayName} to meet at ${placeName} ${whenPhrase(pickedStart, timeZone)}. They can accept or decline.`}
          </Text>
          <Divider />
          <SummaryRow label="When" value={exactMeetupTime(pickedStart, timeZone)} sub={zone ? `Campus time (${zone})` : undefined} />
          <SummaryRow
            label="Where"
            value={placeName}
            sub={customAddress ? 'Address you entered' : selectedSpot?.description}
            demo={!customAddress && !!selectedSpot?.isDemo}
          />
        </Card>

        <Text variant="body" color="inkMuted">
          Nothing is booked yet. {listing.seller.displayName} is notified and decides. If they accept, you pay the seller
          in person when you meet. Dibbs never handles money.
        </Text>

        <ServerErrorNote error={error} />
        <Button title="Send request" size="lg" onPress={confirm} loading={requestMutation.isPending} />
        <Button
          title="Change time or place"
          variant="ghost"
          onPress={() => {
            setError(null);
            setStep('pick');
          }}
          disabled={requestMutation.isPending}
        />
      </Screen>
    );
  }

  // ---- Pick
  const missing = !pickedStart && !placeReady ? 'a time and a place' : !pickedStart ? 'a time' : 'a place';
  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title }} />
      {header}

      <View style={styles.notice} accessibilityRole="text">
        <Text variant="body">
          This listing is in the Archive. Pick a time and a place, and {listing.seller.displayName} accepts or declines.
        </Text>
      </View>

      <ServerErrorNote error={error} />

      <View style={styles.section}>
        <Text variant="title" accessibilityRole="header">
          Pick a time
        </Text>
        <Text variant="caption" color="inkMuted">
          15-minute meetups in campus time{zone ? ` (${zone})` : ''}, between 7 AM and 11 PM, in the next 7 days.
        </Text>
        {!timeZone ? (
          campusesQuery.isError || slotsQuery.isError ? (
            <ErrorState
              message="Could not load the campus time zone."
              onRetry={() => {
                campusesQuery.refetch();
                slotsQuery.refetch();
              }}
            />
          ) : (
            <Skeleton height={160} />
          )
        ) : (
          <ProposalTimePicker
            starts={starts}
            timeZone={timeZone}
            selectedIso={pickedStart}
            onSelect={(iso) => {
              setError(null);
              setStartsAt(iso);
            }}
          />
        )}
      </View>

      <View style={styles.section}>
        <Text variant="title" accessibilityRole="header">
          Pick a place
        </Text>
        {spotsQuery.isPending ? (
          <Skeleton height={120} />
        ) : spotsQuery.isError ? (
          <ErrorState message={spotsQuery.error.message} onRetry={() => spotsQuery.refetch()} />
        ) : (
          <>
            {spots.length === 0 ? (
              <Text variant="body" color="inkMuted">
                No campus meetup places are listed. You can check another address below.
              </Text>
            ) : null}
            <SpotPicker
              spots={spots}
              selectedId={spotId}
              onSelect={(id) => {
                setError(null);
                setSpotId(id);
              }}
              campusId={listing.campusId}
              customAddress={customAddress}
              onCustomAddressChange={(resolved) => {
                setCustomAddress(resolved);
                if (resolved) setSpotId(undefined);
              }}
            />
          </>
        )}
      </View>

      <Button
        title="Review request"
        size="lg"
        onPress={review}
        disabled={!pickedStart || !placeReady}
        accessibilityLabel={!pickedStart || !placeReady ? `Review request. Pick ${missing} first.` : 'Review request'}
      />
      {!pickedStart || !placeReady ? (
        <Text variant="caption" color="inkMuted" style={styles.hint}>
          {`Pick ${missing} to continue.`}
        </Text>
      ) : null}
      <Button title="Back" variant="ghost" onPress={goToListing} />
    </Screen>
  );
}

function SummaryRow({ label, value, sub, demo }: { label: string; value: string; sub?: string; demo?: boolean }) {
  return (
    <View style={styles.summaryRow} accessible accessibilityLabel={`${label}: ${value}${sub ? `. ${sub}` : ''}`}>
      <Text variant="caption" color="inkMuted">
        {label}
      </Text>
      <View style={styles.valueRow}>
        <Text variant="heading" style={styles.valueText}>
          {value}
        </Text>
        <DemoBadge visible={!!demo} />
      </View>
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
  valueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  valueText: { flexShrink: 1 },
  hint: { textAlign: 'center', marginTop: -space.md },
  notice: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md },
});
