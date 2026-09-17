/**
 * Item detail screen: gallery, price/title, condition/size/brand/category
 * chips, description, pickup section (spots + next windows), seller row,
 * "more from this seller", share/save/report, and a sticky bottom action bar
 * that differs for the seller vs. everyone else.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, Share as ShareIcon } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { PriceText } from '@/components/ui/PriceText';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhotoGallery } from '@/components/PhotoGallery';
import { SellerRow } from '@/components/SellerRow';
import { TrustCompact } from '@/components/TrustSignals';
import { SpotPicker } from '@/components/SpotPicker';
import { ListingCard } from '@/components/ListingCard';
import { StatusBanner } from '@/components/browse/StatusBanner';
import { AuctionPanel } from '@/components/auction/AuctionPanel';
import { BidSheet } from '@/components/auction/BidSheet';
import { useCountdown } from '@/components/auction/useCountdown';
import { ReportSheet } from '@/components/browse/ReportSheet';
import { trpc } from '@/lib/trpc';
import { useRequireAuth } from '@/hooks/useAuth';
import { confirmAction } from '@/utils/confirm';
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
  const utils = trpc.useUtils();

  const [reportOpen, setReportOpen] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);

  const listingQuery = trpc.listing.byId.useQuery({ id }, { enabled: !!id });
  const listing = listingQuery.data;

  const campusesQuery = trpc.campus.list.useQuery();
  const timeZone = useMemo(
    () => campusesQuery.data?.find((c) => c.id === listing?.campusId)?.timezone,
    [campusesQuery.data, listing?.campusId],
  );

  const isAuction = listing?.saleType === 'auction';

  const bidsQuery = trpc.bid.forListing.useQuery(
    { listingId: id! },
    { enabled: !!id && isAuction },
  );

  const auctionClock = useCountdown(isAuction ? (listing?.expiresAt ?? null) : null);

  const refreshAuction = useCallback(async () => {
    if (!id) return;
    await Promise.all([
      utils.listing.byId.invalidate({ id }),
      utils.bid.forListing.invalidate({ listingId: id }),
      utils.listing.feed.invalidate(),
    ]);
  }, [id, utils]);

  const placeBidMutation = trpc.bid.place.useMutation({
    onSuccess: async (res) => {
      setBidOpen(false);
      setBidError(null);
      await refreshAuction();
      Alert.alert(
        res.extended ? 'Bid placed — auction extended' : 'Bid placed',
        res.extended
          ? 'Your bid landed in the final 2 minutes, so the auction was extended by 2 minutes. This is a prototype — no money moves.'
          : 'You are the top bidder. A bid is a commitment to buy. This is a prototype — no money moves.',
      );
    },
    onError: (err) => setBidError(err.message),
  });

  const buyoutMutation = trpc.bid.buyout.useMutation({
    onSuccess: async (res) => {
      await refreshAuction();
      await utils.reservation.mine.invalidate();
      if (res.reservationId) router.push(`/reservation/${res.reservationId}`);
      else Alert.alert('Bought', 'The seller will be in touch to arrange the handoff.');
    },
    onError: (err) => Alert.alert('Could not buy it now', err.message),
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
    const link = `campusswap://listing/${listing.id}`;
    try {
      await Share.share({
        title: listing.title,
        message: `${listing.title}\n${link}`,
        url: link,
      });
    } catch {
      // user cancelled or share unavailable; nothing to do
    }
  }, [listing]);

  const onMessage = useCallback(() => {
    if (!id) return;
    if (!requireAuth(`/listing/${id}`)) return;
    openConversationMutation.mutate({ listingId: id });
  }, [id, requireAuth, openConversationMutation]);

  const onRequestMeetup = useCallback(() => {
    if (!id) return;
    if (!requireAuth(`/listing/${id}`)) return;
    router.push({ pathname: '/reservation/request', params: { listingId: id } });
  }, [id, requireAuth, router]);

  const onPlaceBid = useCallback(() => {
    if (!id) return;
    if (!requireAuth(`/listing/${id}`)) return;
    setBidError(null);
    setBidOpen(true);
  }, [id, requireAuth]);

  const onBuyItNow = useCallback(() => {
    if (!id || !listing?.buyoutPriceCents) return;
    if (!requireAuth(`/listing/${id}`)) return;
    confirmAction(
      `Buy it now for ${formatPrice(listing.buyoutPriceCents)}?`,
      'This ends the auction and commits you to meeting the seller. No money moves in this prototype.',
      'Buy it now',
      () => buyoutMutation.mutate({ listingId: id }),
    );
  }, [id, listing?.buyoutPriceCents, requireAuth, buyoutMutation]);

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
        <Skeleton height={320} radius={14} />
        <Skeleton width="50%" height={24} style={styles.loadingLine} />
        <Skeleton width="80%" height={16} style={styles.loadingLine} />
        <Skeleton width="60%" height={16} style={styles.loadingLine} />
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
    .filter((w) => new Date(w.endsAt).getTime() > Date.now())
    .slice(0, 3);

  const isSeller = listing.viewerRole === 'seller';
  const unavailableCopy =
    listing.status === 'reserved'
      ? 'This item is reserved by another buyer right now.'
      : listing.status === 'sold'
        ? 'This item has already been sold.'
        : listing.status === 'expired'
          ? listing.saleType === 'auction'
            ? 'This auction ended with no bids.'
            : 'This listing has expired.'
          : undefined;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: listing.title }} />
      <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
        <PhotoGallery photos={listing.photos} />

        <View style={styles.content}>
          <StatusBanner status={listing.status} />

          <View style={styles.priceRow}>
            <PriceText cents={isAuction ? listing.currentPriceCents : listing.priceCents} />
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

          {listing.saleType === 'auction' ? (
            <View style={styles.auctionWrap}>
              <AuctionPanel
                currentPriceCents={listing.currentPriceCents}
                startPriceCents={listing.startPriceCents}
                buyoutPriceCents={listing.buyoutPriceCents}
                bidCount={listing.bidCount}
                expiresAt={listing.expiresAt}
                bids={bidsQuery.data ?? []}
              />
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
              Next available times
            </Text>
            {upcomingWindows.length === 0 ? (
              <Text variant="body" color="inkFaint" style={styles.noWindows}>
                No upcoming pickup times listed.
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
                    <ListingCard listing={item} onPress={() => router.push(`/listing/${item.id}`)} />
                  </View>
                )}
              />
            </>
          ) : null}

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
            <Button
              title="Requests"
              variant="ghost"
              onPress={() => router.push('/(tabs)/inbox')}
              style={styles.footerBtnFlex}
            />
          </View>
        ) : (
          <>
            {unavailableCopy ? (
              <Text variant="caption" color="inkMuted" style={styles.unavailableNote}>
                {unavailableCopy}
              </Text>
            ) : null}
            {isAuction && listing.status === 'active' && !auctionClock.ended ? (
              <>
                <Text variant="caption" color="inkMuted" style={styles.unavailableNote}>
                  A bid is a commitment to buy, not a reservation.
                </Text>
                <View style={styles.footerRow}>
                  <Button
                    title="Message"
                    variant="ghost"
                    onPress={onMessage}
                    loading={openConversationMutation.isPending}
                    style={styles.footerBtnFlex}
                  />
                  {listing.buyoutPriceCents != null ? (
                    <Button
                      title={`Buy now ${formatPrice(listing.buyoutPriceCents)}`}
                      variant="secondary"
                      onPress={onBuyItNow}
                      loading={buyoutMutation.isPending}
                      style={styles.footerBtnFlex}
                    />
                  ) : null}
                  <Button
                    title="Place bid"
                    onPress={onPlaceBid}
                    style={styles.footerBtnPrimary}
                    accessibilityLabel={`Place bid, current price ${formatPrice(listing.currentPriceCents)}`}
                  />
                </View>
              </>
            ) : (
              <View style={styles.footerRow}>
                <Button
                  title="Message"
                  variant="secondary"
                  onPress={onMessage}
                  loading={openConversationMutation.isPending}
                  style={styles.footerBtnFlex}
                />
                <Button
                  title={isAuction ? 'Auction ended' : 'Request meetup'}
                  onPress={onRequestMeetup}
                  disabled={isAuction || listing.status !== 'active'}
                  accessibilityLabel={
                    listing.status !== 'active' ? `Request meetup, unavailable: ${unavailableCopy}` : 'Request meetup'
                  }
                  style={styles.footerBtnPrimary}
                />
              </View>
            )}
          </>
        )}
      </View>

      <BidSheet
        visible={bidOpen}
        onClose={() => setBidOpen(false)}
        minimumCents={
          listing.bidCount > 0
            ? listing.currentPriceCents + Math.max(100, Math.ceil(listing.currentPriceCents * 0.05))
            : listing.currentPriceCents
        }
        buyoutPriceCents={listing.buyoutPriceCents}
        submitting={placeBidMutation.isPending}
        serverError={bidError}
        onSubmit={(amountCents) => {
          if (!id) return;
          setBidError(null);
          placeBidMutation.mutate({ listingId: id, amountCents });
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
  loadingLine: { marginTop: space.lg, marginHorizontal: space.lg },
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
  footerRow: { flexDirection: 'row', gap: space.md },
  footerBtnFlex: { flex: 1 },
  footerBtnPrimary: { flex: 2 },
  unavailableNote: { marginBottom: space.sm },
  auctionWrap: { marginTop: space.lg },
});
