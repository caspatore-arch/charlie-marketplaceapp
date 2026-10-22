/**
 * Item detail screen: gallery, price/title, condition/size/brand/category
 * chips, description, pickup section (spots + next windows), seller row,
 * "more from this seller", share/save/report, and a sticky bottom action bar
 * that differs for the seller vs. everyone else.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, MessageCircle, Share as ShareIcon } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { PriceText } from '@/components/ui/PriceText';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Skeleton } from '@/components/ui/Skeleton';
import { ListingDetailSkeleton } from '@/components/ui/ListingDetailSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhotoGallery } from '@/components/PhotoGallery';
import { SellerRow } from '@/components/SellerRow';
import { TrustCompact } from '@/components/TrustSignals';
import { SpotPicker } from '@/components/SpotPicker';
import { ListingCard } from '@/components/ListingCard';
import { StatusBanner } from '@/components/browse/StatusBanner';
import { OfferSheet } from '@/components/offers/OfferSheet';
import { BuyerOfferCard } from '@/components/offers/BuyerOfferCard';
import { SellerOffersList } from '@/components/offers/SellerOffersList';
import { ServerErrorNote, type ServerErrorLike } from '@/components/offers/ServerErrorNote';
import { ReservationStatusPill } from '@/components/ReservationStatusPill';
import { exactMeetupTime } from '@/components/booking/time';
import { ListingComments } from '@/components/listing/ListingComments';
import { ReportSheet } from '@/components/browse/ReportSheet';
import { trpc } from '@/lib/trpc';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { confirmAction } from '@/utils/confirm';
import { shareListing } from '@/utils/shareListing';
import { colors, space } from '@/constants/theme';
import { conditionLabel, categoryLabel, formatMeetupTime, formatPrice } from '@/utils/format';
import type { ReportReason } from '@/types';

function formatWindowEnd(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const requireAuth = useRequireAuth();
  const { status: authStatus } = useAuth();
  const utils = trpc.useUtils();

  const [reportOpen, setReportOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerError, setOfferError] = useState<ServerErrorLike | null>(null);
  const [offersActionError, setOffersActionError] = useState<ServerErrorLike | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  // Current time for the availability filter, refreshed each minute so the
  // render itself stays free of Date.now() calls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const listingQuery = trpc.listing.byId.useQuery({ id }, { enabled: !!id });
  const listing = listingQuery.data;

  const campusesQuery = trpc.campus.list.useQuery();

  // The slot chart is the source of truth for "can this still be booked" and
  // carries the campus timezone plus the server's closed message.
  const slotsQuery = trpc.reservation.slots.useQuery({ listingId: id! }, { enabled: !!id });
  const timeZone = useMemo(
    () =>
      slotsQuery.data?.timezone ?? campusesQuery.data?.find((c) => c.id === listing?.campusId)?.timezone,
    [slotsQuery.data?.timezone, campusesQuery.data, listing?.campusId],
  );

  const isLegacyAuction = listing?.saleType === 'auction';
  const isSellerView = listing?.viewerRole === 'seller';

  const offersQuery = trpc.offer.forListing.useQuery(
    { listingId: id! },
    { enabled: !!id && !!listing && authStatus === 'signedIn' && !isLegacyAuction },
  );
  const offers = offersQuery.data;

  const meetupsQuery = trpc.reservation.forListing.useQuery(
    { listingId: id! },
    { enabled: !!id && isSellerView },
  );

  const refreshOffers = useCallback(async () => {
    if (!id) return;
    await Promise.all([
      utils.offer.forListing.invalidate({ listingId: id }),
      utils.offer.mine.invalidate(),
      utils.listing.byId.invalidate({ id }),
      utils.reservation.slots.invalidate({ listingId: id }),
    ]);
  }, [id, utils]);

  const createOfferMutation = trpc.offer.create.useMutation({
    onSuccess: async () => {
      setOfferOpen(false);
      setOfferError(null);
      await refreshOffers();
    },
    onError: (err) => setOfferError(err),
  });
  const withdrawOfferMutation = trpc.offer.withdraw.useMutation({
    onSuccess: refreshOffers,
    onError: (err) => setOffersActionError(err),
  });
  const acceptOfferMutation = trpc.offer.accept.useMutation({
    onSuccess: refreshOffers,
    onError: (err) => setOffersActionError(err),
    onSettled: () => setBusyOfferId(null),
  });
  const declineOfferMutation = trpc.offer.decline.useMutation({
    onSuccess: refreshOffers,
    onError: (err) => setOffersActionError(err),
    onSettled: () => setBusyOfferId(null),
  });

  const sellerTrustQuery = trpc.user.trustSummary.useQuery(
    { id: listing?.seller.id ?? '' },
    { enabled: !!listing },
  );

  const bySellerQuery = trpc.listing.bySeller.useQuery(
    { sellerId: listing?.seller.id ?? '' },
    { enabled: !!listing },
  );
  const moreFromSeller = (bySellerQuery.data ?? []).filter((l) => l.id !== id);

  const toggleSaveMutation = trpc.listing.toggleSave.useMutation({
    onMutate: async (vars) => {
      await utils.listing.byId.cancel({ id: vars.id });
      const prev = utils.listing.byId.getData({ id: vars.id });
      if (prev) utils.listing.byId.setData({ id: vars.id }, { ...prev, isSaved: !prev.isSaved });
      return { prev };
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) utils.listing.byId.setData({ id: vars.id }, ctx.prev);
    },
    onSettled: (_data, _err, vars) => {
      utils.listing.byId.invalidate({ id: vars.id });
      utils.listing.saved.invalidate();
    },
  });

  const openConversationMutation = trpc.conversation.open.useMutation({
    onSuccess: (convo) => router.push(`/conversation/${convo.id}`),
    onError: (err) => Alert.alert('Could not open conversation', err.message),
  });

  const reportMutation = trpc.user.report.useMutation({
    onSuccess: () => {
      setReportOpen(false);
      Alert.alert('Report submitted', 'Thanks — our team will take a look.');
    },
    onError: (err) => Alert.alert('Could not submit report', err.message),
  });

  const onToggleSave = useCallback(() => {
    if (!id) return;
    if (!requireAuth(`/listing/${id}`)) return;
    toggleSaveMutation.mutate({ id });
  }, [id, requireAuth, toggleSaveMutation]);

  const onShare = useCallback(async () => {
    if (!listing) return;
    await shareListing({ id: listing.id, title: listing.title });
  }, [listing]);

  const onMessage = useCallback(() => {
    if (!id) return;
    if (!requireAuth(`/listing/${id}`)) return;
    openConversationMutation.mutate({ listingId: id });
  }, [id, requireAuth, openConversationMutation]);

  const onBook = useCallback(
    (offerId?: string, offerCents?: number) => {
      if (!id) return;
      if (!requireAuth(`/listing/${id}`)) return;
      router.push({
        pathname: '/reservation/request',
        params: {
          listingId: id,
          ...(offerId ? { offerId, offerCents: String(offerCents ?? '') } : {}),
        },
      });
    },
    [id, requireAuth, router],
  );

  const onMakeOffer = useCallback(() => {
    if (!id) return;
    if (!requireAuth(`/listing/${id}`)) return;
    setOfferError(null);
    setOfferOpen(true);
  }, [id, requireAuth]);

  const onAcceptOffer = useCallback(
    (offer: { id: string; amountCents: number; buyer: { displayName: string } }) => {
      confirmAction(
        `Accept ${formatPrice(offer.amountCents)} from ${offer.buyer.displayName}?`,
        'The item is held for them for one hour so they can book a meetup time. Nobody else can book meanwhile.',
        'Accept offer',
        () => {
          setOffersActionError(null);
          setBusyOfferId(offer.id);
          acceptOfferMutation.mutate({ id: offer.id });
        },
        { destructive: false },
      );
    },
    [acceptOfferMutation],
  );

  const onDeclineOffer = useCallback(
    (offer: { id: string; amountCents: number; buyer: { displayName: string } }) => {
      confirmAction(
        `Decline ${formatPrice(offer.amountCents)} from ${offer.buyer.displayName}?`,
        'They will be told. They can make a new offer.',
        'Decline offer',
        () => {
          setOffersActionError(null);
          setBusyOfferId(offer.id);
          declineOfferMutation.mutate({ id: offer.id });
        },
      );
    },
    [declineOfferMutation],
  );

  const onWithdrawOffer = useCallback(
    (offerId: string) => {
      setOffersActionError(null);
      withdrawOfferMutation.mutate({ id: offerId });
    },
    [withdrawOfferMutation],
  );

  const onReport = useCallback(() => {
    if (!id) return;
    if (!requireAuth(`/listing/${id}`)) return;
    setReportOpen(true);
  }, [id, requireAuth]);

  const submitReport = useCallback(
    (reason: ReportReason, details?: string) => {
      if (!id) return;
      reportMutation.mutate({ targetListingId: id, reason, details });
    },
    [id, reportMutation],
  );

  if (listingQuery.isPending) {
    return (
      <Screen scroll>
        <ListingDetailSkeleton />
      </Screen>
    );
  }

  if (listingQuery.isError) {
    return (
      <Screen>
        <ErrorState message={listingQuery.error.message} onRetry={() => listingQuery.refetch()} />
      </Screen>
    );
  }

  if (!listing) {
    return (
      <Screen>
        <EmptyState title="Item not found" body="This listing may have been removed." />
      </Screen>
    );
  }

  const upcomingWindows = (listing.availabilityWindows ?? [])
    .filter((w) => new Date(w.endsAt).getTime() > now)
    .slice(0, 3);

  const isSeller = listing.viewerRole === 'seller';
  const isAuction = listing.saleType === 'auction';
  const legacyAuctionNote = slotsQuery.data?.closedReason ?? 'This was posted as an auction and closes at its original end time.';
  const unavailableCopy = isAuction
    ? legacyAuctionNote
    : listing.status === 'reserved'
      ? 'This item is already booked by another buyer.'
      : listing.status === 'sold'
        ? 'This item has already been sold.'
        : listing.status === 'expired'
          ? 'This listing has expired.'
          : slotsQuery.data && !slotsQuery.data.open
            ? (slotsQuery.data.closedReason ?? undefined)
            : undefined;
  const bookable = !isAuction && listing.status === 'active' && slotsQuery.data?.open !== false;
  const noOpenTimes =
    bookable && !!slotsQuery.data && slotsQuery.data.slots.every((sl) => !sl.available);
  const heldByOther = !!offers?.heldByOther;
  const heldByViewer = !!offers?.heldByViewer;
  const heldOffer = heldByViewer ? offers?.offers.find((o) => o.status === 'accepted') : undefined;
  const bookingPriceCents = heldOffer?.amountCents ?? listing.priceCents;

  const messageIconButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Message ${listing.seller.displayName}`}
      onPress={onMessage}
      disabled={openConversationMutation.isPending}
      style={({ pressed }) => [styles.footerIconBtn, pressed && styles.footerIconBtnPressed]}
    >
      {openConversationMutation.isPending ? (
        <ActivityIndicator size="small" color={colors.ink} />
      ) : (
        <MessageCircle size={22} color={colors.ink} />
      )}
    </Pressable>
  );

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: listing.title }} />
      <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
        <PhotoGallery photos={listing.photos} />

        <View style={styles.content}>
          <StatusBanner status={listing.status} />

          <View style={styles.priceRow}>
            <View>
              <PriceText cents={listing.priceCents} />
              {!isAuction ? (
                <Text variant="caption" color="inkMuted">
                  Asking price
                </Text>
              ) : null}
            </View>
            <View style={styles.iconRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share this listing"
                onPress={onShare}
                style={styles.iconBtn}
              >
                <ShareIcon size={22} color={colors.ink} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={listing.isSaved ? 'Remove from saved items' : 'Save this listing'}
                accessibilityState={{ selected: listing.isSaved }}
                onPress={onToggleSave}
                style={styles.iconBtn}
              >
                <Heart
                  size={22}
                  color={listing.isSaved ? colors.accent : colors.ink}
                  fill={listing.isSaved ? colors.accent : 'none'}
                />
              </Pressable>
            </View>
          </View>

          <Text variant="title" style={styles.titleText}>
            {listing.title}
          </Text>

          <View style={styles.chipsRow}>
            <Badge kind="status" label={conditionLabel(listing.condition)} tone="neutral" />
            {listing.size ? <Badge kind="status" label={listing.size} tone="neutral" /> : null}
            {listing.brand ? <Badge kind="status" label={listing.brand} tone="neutral" /> : null}
            <Badge kind="status" label={categoryLabel(listing.category)} tone="neutral" />
          </View>

          {isAuction ? (
            <View style={styles.noticeBox}>
              <Text variant="body" color="inkMuted">
                {legacyAuctionNote}
              </Text>
            </View>
          ) : null}

          {!isAuction && !isSeller && offers ? (
            <BuyerOfferCard
              data={offers}
              timeZone={timeZone}
              withdrawing={withdrawOfferMutation.isPending}
              onWithdraw={onWithdrawOffer}
              onBook={(offerId, cents) => onBook(offerId, cents)}
            />
          ) : null}
          {!isAuction && !isSeller && offersActionError ? (
            <View style={styles.noticeBox}>
              <ServerErrorNote error={offersActionError} />
            </View>
          ) : null}

          {listing.description ? (
            <Text variant="body" color="inkMuted" style={styles.description}>
              {listing.description}
            </Text>
          ) : null}

          <Divider style={styles.divider} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${listing.seller.displayName}'s profile`}
            onPress={() => router.push(`/user/${listing.seller.id}`)}
          >
            <SellerRow seller={listing.seller} />
          </Pressable>
          {sellerTrustQuery.data ? (
            <View style={styles.sellerTrust}>
              <TrustCompact summary={sellerTrustQuery.data} />
            </View>
          ) : null}

          <Divider style={styles.divider} />

          <Text variant="heading" style={styles.sectionTitle}>
            Pickup
          </Text>
          {listing.spots.length > 0 ? (
            <SpotPicker spots={listing.spots} />
          ) : (
            <Text variant="body" color="inkMuted">
              The seller hasn&apos;t listed any pickup spots.
            </Text>
          )}

          <View style={styles.windowsWrap}>
            <Text variant="label" color="inkMuted">
              Open times (campus time)
            </Text>
            {upcomingWindows.length === 0 ? (
              // Say what the buyer can do, not just what is missing. Requesting
              // a meetup still works with no posted windows — the buyer
              // proposes the time — and the old copy read like a dead end
              // sitting directly above the primary button.
              <Text variant="body" color="inkFaint" style={styles.noWindows}>
                {isSeller
                  ? "You haven't posted meetup times. Edit the listing to add a window buyers can book."
                  : 'No open times on this listing right now. Message the seller.'}
              </Text>
            ) : (
              upcomingWindows.map((w) => (
                <Text key={w.id} variant="body" style={styles.windowRow}>
                  {formatMeetupTime(w.startsAt as unknown as string, timeZone)} –{' '}
                  {formatWindowEnd(w.endsAt as unknown as string, timeZone)}
                </Text>
              ))
            )}
          </View>

          {isSeller && !isAuction ? (
            <>
              <Divider style={styles.divider} />
              <Text variant="heading" style={styles.sectionTitle}>
                Offers
              </Text>
              {offersActionError ? (
                <View style={styles.sectionGap}>
                  <ServerErrorNote error={offersActionError} />
                </View>
              ) : null}
              {offersQuery.isPending ? (
                <Skeleton height={72} />
              ) : offersQuery.isError ? (
                <ErrorState message={offersQuery.error.message} onRetry={() => offersQuery.refetch()} />
              ) : (
                <SellerOffersList
                  offers={offers?.offers ?? []}
                  timeZone={timeZone}
                  busyId={busyOfferId}
                  onAccept={onAcceptOffer}
                  onDecline={onDeclineOffer}
                />
              )}

              <Text variant="heading" style={[styles.sectionTitle, styles.sectionGap]}>
                Booked meetups
              </Text>
              {meetupsQuery.isPending ? (
                <Skeleton height={56} />
              ) : (meetupsQuery.data ?? []).length === 0 ? (
                <Text variant="body" color="inkMuted">
                  No one has booked a time yet.
                </Text>
              ) : (
                <View style={styles.meetupList}>
                  {(meetupsQuery.data ?? []).map((m) => (
                    <Pressable
                      key={m.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open meetup ${exactMeetupTime(m.startsAt, timeZone)}`}
                      onPress={() => router.push(`/reservation/${m.id}`)}
                      style={styles.meetupRow}
                    >
                      <View style={styles.flex}>
                        <Text variant="label" weight="600">
                          {exactMeetupTime(m.startsAt, timeZone)}
                        </Text>
                        <Text variant="caption" color="inkMuted">
                          {m.buyer.displayName}
                        </Text>
                        <Text variant="caption" color="inkMuted">
                          {formatPrice(m.priceCents)}
                          {m.offerId ? ' · agreed offer' : ''}
                        </Text>
                      </View>
                      <ReservationStatusPill status={m.status} />
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          ) : null}

          {moreFromSeller.length > 0 ? (
            <>
              <Divider style={styles.divider} />
              <Text variant="heading" style={styles.sectionTitle}>
                More from this seller
              </Text>
              <FlatList
                data={moreFromSeller}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.sellerListContent}
                renderItem={({ item }) => (
                  <View style={styles.sellerListCell}>
                    <ListingCard
                      listing={item}
                      onPress={() => router.push(`/listing/${item.id}`)}
                      showSeller={false}
                    />
                  </View>
                )}
              />
            </>
          ) : null}

          <Divider style={styles.divider} />

          <ListingComments
            listingId={listing.id}
            canComment={listing.status === 'active' || listing.status === 'reserved'}
          />

          <Divider style={styles.divider} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Report this listing"
            onPress={onReport}
            style={styles.reportBtn}
          >
            <Text variant="label" color="inkFaint">
              Report this listing
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        {isSeller ? (
          <View style={styles.footerRow}>
            <Button
              title="Edit listing"
              variant="secondary"
              onPress={() => router.push(`/listing/${listing.id}/edit`)}
              style={styles.footerBtnFlex}
            />
          </View>
        ) : (
          <>
            {unavailableCopy ? (
              <Text variant="caption" color="inkMuted" style={styles.unavailableNote}>
                {unavailableCopy}
              </Text>
            ) : heldByOther ? (
              <Text variant="caption" color="inkMuted" style={styles.unavailableNote}>
                Another buyer&apos;s offer was accepted; this may open up again.
              </Text>
            ) : noOpenTimes ? (
              <Text variant="caption" color="inkMuted" style={styles.unavailableNote}>
                No open times — message the seller.
              </Text>
            ) : null}
            <View style={styles.footerRow}>
              {messageIconButton}
              {isAuction ? null : (
                <>
                  {heldByViewer ? null : (
                    <Button
                      title="Offer"
                      variant="secondary"
                      onPress={onMakeOffer}
                      disabled={!bookable || heldByOther || offers?.offers[0]?.status === 'pending'}
                      style={styles.footerBtnOffer}
                      accessibilityLabel="Make an offer below the asking price"
                    />
                  )}
                  <Button
                    title={heldByViewer && heldOffer ? `Book at ${formatPrice(bookingPriceCents)}` : 'Book meetup'}
                    onPress={() => onBook(heldOffer?.id, heldOffer?.amountCents)}
                    disabled={!bookable || heldByOther}
                    style={styles.footerBtnBook}
                    accessibilityLabel={
                      !bookable || heldByOther
                        ? `Book a meetup, unavailable${unavailableCopy ? `: ${unavailableCopy}` : ''}`
                        : `Book a meetup at ${formatPrice(bookingPriceCents)}`
                    }
                  />
                </>
              )}
            </View>
          </>
        )}
      </View>

      <OfferSheet
        visible={offerOpen}
        onClose={() => setOfferOpen(false)}
        askingPriceCents={listing.priceCents}
        submitting={createOfferMutation.isPending}
        serverError={offerError}
        windows={listing.availabilityWindows}
        spots={listing.spots}
        timeZone={timeZone}
        onSubmit={(amountCents, message, proposal) => {
          if (!id) return;
          setOfferError(null);
          createOfferMutation.mutate({
            listingId: id,
            amountCents,
            message,
            proposedStartsAt: proposal.startsAt,
            proposedSpotId: proposal.spotId,
          });
        }}
      />

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
        loading={reportMutation.isPending}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxl },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconRow: { flexDirection: 'row', gap: space.sm },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  titleText: { marginTop: space.sm },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  description: { marginTop: space.lg, lineHeight: 22 },
  divider: { marginVertical: space.xl },
  sectionTitle: { marginBottom: space.md },
  sellerTrust: { marginTop: space.sm, marginLeft: 36 + space.md },
  windowsWrap: { marginTop: space.lg, gap: 4 },
  windowRow: { marginTop: 2 },
  noWindows: { marginTop: 2 },
  sellerListContent: { gap: space.md, paddingRight: space.lg },
  sellerListCell: { width: 150 },
  reportBtn: { minHeight: 48, justifyContent: 'center' },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  footerBtnFlex: { flex: 1 },
  // "Offer" is short; give "Book meetup" the room so neither label truncates at 375pt.
  footerBtnOffer: { flex: 2 },
  footerBtnBook: { flex: 3 },
  footerBtnPrimary: { flex: 2 },
  // Message is an icon, not a text button (docs/DESIGN.md). A "Message" label
  // costs ~90px of a 343px bar, which is exactly what pushed "Buy now $60"
  // into a three-line wrap on a 375pt screen.
  footerIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  footerIconBtnPressed: { opacity: 0.6 },
  unavailableNote: { marginBottom: space.sm },
  noticeBox: { marginTop: space.lg },
  sectionGap: { marginTop: space.lg, marginBottom: space.sm },
  meetupList: { gap: space.sm },
  meetupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    padding: space.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
});
