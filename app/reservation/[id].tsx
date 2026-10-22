/**
 * The meetup card screen (`reservation.byId`). Same card for both parties:
 * item + price + spot + time (via the shared MeetupCard), plus a
 * status-specific action area: handoff code show/enter + confirm while
 * accepted, a "They didn't show up" path after the start time, success +
 * report while completed, and explicit copy for declined/cancelled/expired.
 * The pieces live in components/reservation/*.
 */
import React, { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, useIsFocused, Stack } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { MeetupCard } from '@/components/MeetupCard';
import { ReservationPaymentRow } from '@/components/payments/ReservationPaymentRow';
import { OpenActionsForProposer, OpenActionsForResponder } from '@/components/reservation/OpenActions';
import { AcceptedActions } from '@/components/reservation/AcceptedActions';
import { ClosedActions, CompletedActions } from '@/components/reservation/FinalActions';
import { HistorySection } from '@/components/reservation/HistorySection';
import { ProposeSheet } from '@/components/reservation/ProposeSheet';
import { CancelSheet } from '@/components/reservation/CancelSheet';
import { ReportSheet } from '@/components/reservation/ReportSheet';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { OFFERS_ENABLED } from '@/constants/features';
import { space } from '@/constants/theme';

const POLL_MS = 8_000;

export default function ReservationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const query = trpc.reservation.byId.useQuery({ id }, { enabled: !!id, refetchInterval: isFocused ? POLL_MS : false });

  const contactQuery = trpc.user.contactSettings.useQuery();
  const textsOn = !!(contactQuery.data?.smsOptIn && contactQuery.data?.phoneVerified);
  const historyQuery = trpc.reservation.history.useQuery({ id }, { enabled: !!id });

  // Errors from the buttons in the action area show right above those buttons;
  // errors from a sheet show inside that sheet. Both clear when a new try starts.
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [noShowMode, setNoShowMode] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const invalidateAll = useCallback(() => {
    utils.reservation.byId.invalidate({ id });
    utils.reservation.history.invalidate({ id });
    utils.reservation.slots.invalidate();
    utils.reservation.mine.invalidate();
    utils.listing.byId.invalidate({ id: query.data?.listingId ?? '' });
    utils.conversation.list.invalidate();
  }, [utils, id, query.data?.listingId]);

  const onActionError = useCallback((err: { message: string }) => setActionError(err.message), []);
  const onSheetError = useCallback((err: { message: string }) => setSheetError(err.message), []);
  const clearErrors = useCallback(() => {
    setActionError(null);
    setSheetError(null);
  }, []);

  const acceptMutation = trpc.reservation.accept.useMutation({
    onMutate: clearErrors,
    onSuccess: invalidateAll,
    onError: onActionError,
  });
  const declineMutation = trpc.reservation.decline.useMutation({
    onMutate: clearErrors,
    onSuccess: invalidateAll,
    onError: onActionError,
  });
  const cancelMutation = trpc.reservation.cancel.useMutation({
    onMutate: clearErrors,
    onSuccess: () => {
      invalidateAll();
      setCancelOpen(false);
    },
    onError: (err) => (cancelOpen ? onSheetError(err) : onActionError(err)),
  });
  const confirmHandoffMutation = trpc.reservation.confirmHandoff.useMutation({
    onMutate: clearErrors,
    onSuccess: invalidateAll,
    onError: onActionError,
  });
  const openConversationMutation = trpc.conversation.open.useMutation({
    onSuccess: (c) => router.push(`/conversation/${c.id}`),
    onError: (err) => Alert.alert('Could not open conversation', err.message),
  });
  const reportMutation = trpc.user.report.useMutation({
    onMutate: clearErrors,
    onSuccess: () => {
      setReportOpen(false);
      Alert.alert('Report sent', "We'll review this account.");
    },
    onError: onSheetError,
  });
  const counterMutation = trpc.reservation.counter.useMutation({
    onMutate: clearErrors,
    onSuccess: () => {
      invalidateAll();
      setProposeOpen(false);
    },
    onError: (err) => (proposeOpen ? onSheetError(err) : onActionError(err)),
  });

  const reservation = query.data;
  // Campus time: the viewer's campus, else the listing's slot chart zone, so a
  // time is never shown without a zone label.
  const viewerZone = user?.campus?.timezone;
  const zoneQuery = trpc.reservation.slots.useQuery(
    { listingId: reservation?.listingId ?? '' },
    { enabled: !!reservation && !viewerZone },
  );
  const timeZone = viewerZone ?? zoneQuery.data?.timezone;
  const startPassed = !!reservation && reservation.startsAt.getTime() <= query.dataUpdatedAt;
  const isClosed = !!reservation && ['completed', 'declined', 'cancelled', 'expired'].includes(reservation.status);
  const isOpen = !!reservation && !isClosed;

  const isBuyer = !!(reservation && user && reservation.buyerId === user.id);
  const isSeller = !!(reservation && user && reservation.sellerId === user.id);
  const iProposed = !!(reservation && user && reservation.proposedById === user.id);
  const otherParty = reservation ? (isBuyer ? reservation.seller : reservation.buyer) : undefined;

  const goToConversation = useCallback(() => {
    if (!reservation) return;
    if (isBuyer) {
      openConversationMutation.mutate({ listingId: reservation.listingId });
    } else {
      openConversationMutation.mutate({
        listingId: reservation.listingId,
        buyerId: reservation.buyerId,
      });
    }
  }, [reservation, isBuyer, openConversationMutation]);

  const confirmCancel = useCallback(
    (reason?: string) => {
      if (!reservation) return;
      cancelMutation.mutate({ id: reservation.id, reason: reason?.trim() || undefined });
    },
    [reservation, cancelMutation],
  );

  if (query.isPending) {
    return (
      <Screen scroll>
        <View style={styles.loadingWrap}>
          <Skeleton height={220} />
          <Skeleton height={80} />
        </View>
      </Screen>
    );
  }

  if (query.isError || !reservation) {
    return (
      <Screen>
        <ErrorState message={query.error?.message ?? 'This meetup could not be found.'} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flexFill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Screen scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Meetup' }} />

      <MeetupCard
        photoUrl={reservation.listing.coverPhotoUrl}
        title={reservation.listing.title}
        priceCents={reservation.priceCents}
        spotName={reservation.spot?.name}
        spotDescription={reservation.spot?.description}
        spotHoursNote={reservation.spot?.hoursNote}
        spotIsDemo={reservation.spot?.isDemo}
        customAddress={reservation.customAddress}
        startsAt={reservation.startsAt.toISOString()}
        timeZone={timeZone}
        status={reservation.status}
        agreedOffer={OFFERS_ENABLED && !!reservation.offerId}
        onPressDirections={
          reservation.directionsUrl ? () => Linking.openURL(reservation.directionsUrl!) : undefined
        }
      />

      <View style={styles.actionArea}>
        {(reservation.status === 'requested' || reservation.status === 'countered') && !iProposed ? (
          <OpenActionsForResponder
            isSeller={isSeller}
            otherName={otherParty?.displayName ?? 'them'}
            accepting={acceptMutation.isPending}
            declining={declineMutation.isPending}
            cancelling={cancelMutation.isPending}
            error={actionError}
            onAccept={() => acceptMutation.mutate({ id: reservation.id })}
            onPropose={() => {
              clearErrors();
              setProposeOpen(true);
            }}
            onDecline={() => declineMutation.mutate({ id: reservation.id })}
            onCancel={() => confirmCancel()}
          />
        ) : null}

        {(reservation.status === 'requested' || reservation.status === 'countered') && iProposed ? (
          <OpenActionsForProposer
            otherName={otherParty?.displayName ?? 'them'}
            cancelling={cancelMutation.isPending}
            error={actionError}
            onChangeProposal={() => {
              clearErrors();
              setProposeOpen(true);
            }}
            onCancel={() => confirmCancel()}
          />
        ) : null}

        {reservation.status === 'accepted' ? (
          <AcceptedActions
            isBuyer={isBuyer}
            handoffCode={reservation.handoffCode}
            buyerConfirmedAt={reservation.buyerConfirmedAt}
            sellerConfirmedAt={reservation.sellerConfirmedAt}
            confirming={confirmHandoffMutation.isPending}
            error={actionError}
            startPassed={startPassed && !!otherParty}
            onConfirmTap={() => confirmHandoffMutation.mutate({ id: reservation.id })}
            onConfirmCode={(code) => confirmHandoffMutation.mutate({ id: reservation.id, code })}
            onReschedule={() => {
              clearErrors();
              setProposeOpen(true);
            }}
            onCancel={() => {
              clearErrors();
              setCancelOpen(true);
            }}
            onNoShow={() => {
              clearErrors();
              setNoShowMode(true);
              setReportOpen(true);
            }}
          />
        ) : null}

        {reservation.status === 'completed' ? (
          <CompletedActions
            onReport={() => {
              clearErrors();
              setNoShowMode(false);
              setReportOpen(true);
            }}
          />
        ) : null}

        {reservation.status === 'declined' || reservation.status === 'cancelled' || reservation.status === 'expired' ? (
          <ClosedActions status={reservation.status} reason={reservation.cancelReason} />
        ) : null}
      </View>

      <ReservationPaymentRow
        reservationId={reservation.id}
        enabled={reservation.status === 'accepted' || reservation.status === 'completed'}
      />

      {isOpen ? (
        <Card style={styles.infoCard}>
          {textsOn ? (
            <Text variant="caption" color="inkFaint">
              We&apos;ll text you a reminder 30 minutes before.
            </Text>
          ) : (
            <Pressable accessibilityRole="link" onPress={() => router.push('/settings')} hitSlop={8}>
              <Text variant="caption" color="inkFaint">
                Turn on text notifications in Settings to get a reminder 30 minutes before.
              </Text>
            </Pressable>
          )}
        </Card>
      ) : null}

      <Button
        title={`Message ${otherParty?.displayName ?? ''}`.trim()}
        variant={isOpen ? 'secondary' : 'ghost'}
        onPress={goToConversation}
        loading={openConversationMutation.isPending}
        accessibilityLabel={`Message ${otherParty?.displayName ?? 'the other person'} about this meetup`}
      />

      <HistorySection events={historyQuery.data} loading={historyQuery.isPending} timeZone={timeZone} />

      <ProposeSheet
        visible={proposeOpen}
        onClose={() => setProposeOpen(false)}
        listingId={reservation.listingId}
        currentSpotId={reservation.spotId}
        currentCustomAddress={reservation.customAddress}
        currentStartsAt={reservation.startsAt}
        timeZone={timeZone}
        error={sheetError}
        onSubmit={(location, startsAt, note) => {
          counterMutation.mutate({ id: reservation.id, ...location, startsAt, note });
        }}
      />

      <CancelSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => confirmCancel(reason)}
        loading={cancelMutation.isPending}
        error={sheetError}
      />

      <ReportSheet
        key={noShowMode ? 'no-show' : 'problem'}
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        loading={reportMutation.isPending}
        error={sheetError}
        initialReason={noShowMode ? 'no_show' : 'other'}
        title={noShowMode ? 'Report a no-show' : 'Report a problem'}
        onSubmit={(reason, details) =>
          otherParty &&
          reportMutation.mutate({ targetUserId: otherParty.id, reason, details: details || undefined })
        }
      />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },
  loadingWrap: { gap: space.md, padding: space.lg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.huge },
  infoCard: { gap: space.sm },
  actionArea: { gap: space.md },
});
