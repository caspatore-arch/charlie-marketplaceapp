/**
 * Request meetup (modal route, `?listingId=`): item summary, spot picker,
 * day + time-slot picker, optional note, simulated fee breakdown, and the
 * `Send request` action. On success routes to the new reservation's detail
 * screen; on CONFLICT/BAD_REQUEST shows the server's message inline and
 * keeps the form so the buyer can adjust and retry.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { PriceText } from '@/components/ui/PriceText';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { TextArea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Avatar } from '@/components/ui/Avatar';
import { SpotPicker, type ResolvedCustomAddress } from '@/components/SpotPicker';
import { TimeSlotPicker } from '@/components/TimeSlotPicker';
import { FeeBreakdown } from '@/components/FeeBreakdown';
import { trpc, resolveMediaUrl } from '@/lib/trpc';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { colors, space } from '@/constants/theme';
import { conditionLabel } from '@/utils/format';

export default function RequestMeetupScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const requireAuth = useRequireAuth();
  const utils = trpc.useUtils();

  const [spotId, setSpotId] = useState<string | undefined>();
  const [customAddress, setCustomAddress] = useState<ResolvedCustomAddress | null>(null);
  const [startsAt, setStartsAt] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | undefined>();

  useEffect(() => {
    if (authStatus === 'signedOut') {
      requireAuth(`/reservation/request?listingId=${listingId}`);
    }
  }, [authStatus, requireAuth, listingId]);

  const listingQuery = trpc.listing.byId.useQuery({ id: listingId }, { enabled: !!listingId });
  const listing = listingQuery.data;

  const campusesQuery = trpc.campus.list.useQuery();
  const timeZone = useMemo(
    () => campusesQuery.data?.find((c) => c.id === listing?.campusId)?.timezone,
    [campusesQuery.data, listing?.campusId],
  );

  const quoteQuery = trpc.payment.quote.useQuery(
    { priceCents: listing?.priceCents ?? 0 },
    { enabled: !!listing },
  );

  const openConversationMutation = trpc.conversation.open.useMutation();
  const sendMessageMutation = trpc.conversation.send.useMutation();

  const requestMutation = trpc.reservation.request.useMutation({
    onSuccess: async (reservation) => {
      setFormError(undefined);
      try {
        if (note.trim()) {
          const convo = await openConversationMutation.mutateAsync({ listingId: listingId! });
          await sendMessageMutation.mutateAsync({ conversationId: convo.id, body: note.trim() });
        }
      } catch {
        // The request itself succeeded; a failed follow-up message isn't fatal.
      }
      await Promise.all([
        utils.listing.byId.invalidate({ id: listingId }),
        utils.reservation.mine.invalidate(),
      ]);
      router.replace(`/reservation/${reservation.id}`);
    },
    onError: (err) => {
      setFormError(err.message);
    },
  });

  // When the seller offers exactly one spot there is no choice to make, so it
  // starts selected: a required tap that can only be answered one way is just
  // a step. Derived rather than pushed into state by an effect, so there is no
  // render where the form is briefly and wrongly empty.
  const effectiveSpotId =
    spotId ?? (!customAddress && listing?.spots.length === 1 ? listing.spots[0]!.id : undefined);

  const canSubmit =
    (!!effectiveSpotId || !!customAddress) && !!startsAt && !requestMutation.isPending;

  const onSubmit = useCallback(() => {
    if (!listingId || !startsAt || (!effectiveSpotId && !customAddress)) return;
    setFormError(undefined);
    requestMutation.mutate({
      listingId,
      startsAt,
      ...(effectiveSpotId
        ? { spotId: effectiveSpotId }
        : { customAddress: customAddress!.address }),
    });
  }, [listingId, effectiveSpotId, customAddress, startsAt, requestMutation]);

  const coverPhoto = useMemo(() => resolveMediaUrl(listing?.coverPhotoUrl ?? undefined), [listing?.coverPhotoUrl]);

  // TimeSlotPicker's window type is `{ startsAt: string; endsAt: string }`; the
  // server returns real Date instances (superjson, drizzle `mode: 'date'`).
  const windowsForPicker = useMemo(
    () =>
      (listing?.availabilityWindows ?? []).map((w) => ({
        startsAt: new Date(w.startsAt).toISOString(),
        endsAt: new Date(w.endsAt).toISOString(),
      })),
    [listing?.availabilityWindows],
  );

  if (listingQuery.isPending) {
    return (
      <Screen scroll>
        <Skeleton height={80} radius={14} />
        <Skeleton height={160} radius={14} style={styles.loadingBlock} />
        <Skeleton height={160} radius={14} style={styles.loadingBlock} />
      </Screen>
    );
  }

  if (listingQuery.isError || !listing) {
    return (
      <Screen>
        <ErrorState
          message={listingQuery.error?.message ?? 'This item is no longer available.'}
          onRetry={() => listingQuery.refetch()}
        />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Screen scroll contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <Image source={{ uri: coverPhoto }} style={styles.thumb} contentFit="cover" transition={150} />
          <View style={styles.summaryInfo}>
            <Text variant="label" weight="600" numberOfLines={2}>
              {listing.title}
            </Text>
            <Text variant="caption" color="inkMuted">
              {conditionLabel(listing.condition)}
              {listing.size ? ` · ${listing.size}` : ''}
            </Text>
            <PriceText cents={listing.priceCents} style={styles.summaryPrice} />
          </View>
          <Avatar uri={listing.seller.avatarUrl} name={listing.seller.displayName} size={32} />
        </View>

        <Divider style={styles.divider} />

        <Text variant="heading" style={styles.sectionTitle}>
          Where
        </Text>
        {listing.spots.length === 0 ? (
          <Text variant="body" color="inkMuted" style={styles.noSpotsHint}>
            The seller hasn&apos;t listed any pickup spots for this item — you can still propose an
            address below.
          </Text>
        ) : null}
        <SpotPicker
          spots={listing.spots}
          selectedId={effectiveSpotId}
          onSelect={setSpotId}
          campusId={listing.campusId}
          customAddress={customAddress}
          onCustomAddressChange={(resolved) => {
            setCustomAddress(resolved);
            if (resolved) setSpotId(undefined);
          }}
        />

        <Divider style={styles.divider} />

        <Text variant="heading" style={styles.sectionTitle}>
          When
        </Text>
        <TimeSlotPicker
          windows={windowsForPicker}
          selectedIso={startsAt}
          onSelect={setStartsAt}
          timeZone={timeZone}
        />

        <Divider style={styles.divider} />

        <TextArea
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Anything the seller should know before you meet?"
        />

        <Divider style={styles.divider} />

        {quoteQuery.data ? (
          <FeeBreakdown quote={quoteQuery.data} />
        ) : (
          <Skeleton height={80} radius={14} />
        )}

        {formError ? (
          <Text variant="body" color="danger" style={styles.formError} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}

        <Button
          title="Send request"
          onPress={onSubmit}
          disabled={!canSubmit}
          loading={requestMutation.isPending}
          size="lg"
          style={styles.submit}
        />
        {(!effectiveSpotId && !customAddress) || !startsAt ? (
          <Text variant="caption" color="inkFaint" style={styles.hint}>
            Pick a spot and a time to continue.
          </Text>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: space.huge },
  loadingBlock: { marginTop: space.lg },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  summaryInfo: { flex: 1, gap: 2 },
  summaryPrice: { marginTop: 2 },
  divider: { marginVertical: space.xl },
  sectionTitle: { marginBottom: space.md },
  noSpotsHint: { marginBottom: space.md },
  formError: { marginTop: space.lg },
  submit: { marginTop: space.xl },
  hint: { textAlign: 'center', marginTop: space.sm },
});
