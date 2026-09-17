/**
 * The meetup card screen (`reservation.byId`). Same card for both parties:
 * item + price + map placeholder + spot + time (via the shared MeetupCard,
 * composed rather than edited), plus a status-specific action area this
 * screen owns: accept/counter/decline/cancel while open, handoff code
 * show/enter + confirm while accepted, success + report while completed,
 * and explicit copy for declined/cancelled/expired.
 */
import React, { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, useIsFocused, Stack } from 'expo-router';
import { CheckCircle2, MapPin } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { TextArea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Chip } from '@/components/ui/Chip';
import { Divider } from '@/components/ui/Divider';
import { MeetupCard } from '@/components/MeetupCard';
import { DemoBadge } from '@/components/DemoBadge';
import { ReservationPaymentRow } from '@/components/payments/ReservationPaymentRow';
import { SpotPicker, type ResolvedCustomAddress } from '@/components/SpotPicker';
import { TimeSlotPicker } from '@/components/TimeSlotPicker';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/hooks/useAuth';
import { confirmAction } from '@/utils/confirm';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';
import type { ReportReason } from '@/types';

const POLL_MS = 8_000;

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'no_show', label: 'They did not show up' },
  { value: 'scam', label: 'Scam or dishonest listing' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'prohibited_item', label: 'Prohibited item' },
  { value: 'other', label: 'Something else' },
];

export default function ReservationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const query = trpc.reservation.byId.useQuery({ id }, { enabled: !!id, refetchInterval: isFocused ? POLL_MS : false });

  const [actionError, setActionError] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const invalidateAll = useCallback(() => {
    utils.reservation.byId.invalidate({ id });
    utils.reservation.mine.invalidate();
    utils.listing.byId.invalidate({ id: query.data?.listingId ?? '' });
    utils.conversation.list.invalidate();
  }, [utils, id, query.data?.listingId]);

  const onMutationError = useCallback((err: { message: string }) => setActionError(err.message), []);

  const acceptMutation = trpc.reservation.accept.useMutation({
    onSuccess: invalidateAll,
    onError: onMutationError,
  });
  const declineMutation = trpc.reservation.decline.useMutation({
    onSuccess: invalidateAll,
    onError: onMutationError,
  });
  const cancelMutation = trpc.reservation.cancel.useMutation({
    onSuccess: () => {
      invalidateAll();
      setCancelOpen(false);
    },
    onError: onMutationError,
  });
  const confirmHandoffMutation = trpc.reservation.confirmHandoff.useMutation({
    onSuccess: invalidateAll,
    onError: onMutationError,
  });
  const openConversationMutation = trpc.conversation.open.useMutation({
    onSuccess: (c) => router.push(`/conversation/${c.id}`),
    onError: (err) => Alert.alert('Could not open conversation', err.message),
  });
  const reportMutation = trpc.user.report.useMutation({
    onSuccess: () => {
      setReportOpen(false);
      Alert.alert('Report sent', "We'll review this account.");
    },
    onError: onMutationError,
  });
  const counterMutation = trpc.reservation.counter.useMutation({
    onSuccess: () => {
      invalidateAll();
      setProposeOpen(false);
    },
    onError: onMutationError,
  });

  const reservation = query.data;
  const timeZone = user?.campus?.timezone;

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
        customAddress={reservation.customAddress}
        startsAt={reservation.startsAt.toISOString()}
        timeZone={timeZone}
        status={reservation.status}
        onPressDirections={
          reservation.directionsUrl ? () => Linking.openURL(reservation.directionsUrl!) : undefined
        }
      />

      <ReservationPaymentRow
        reservationId={reservation.id}
        enabled={reservation.status === 'accepted' || reservation.status === 'completed'}
      />

      <Card style={styles.infoCard}>
        <View style={styles.infoRow}>
          <MapPin size={16} color={colors.inkFaint} />
          <View style={styles.infoRowText}>
            {reservation.spot ? (
              <>
                <View style={styles.spotNameRow}>
                  <Text variant="label" weight="600">
                    {reservation.spot.name}
                  </Text>
                  <DemoBadge visible={reservation.spot.isDemo} />
                </View>
                {reservation.spot.hoursNote ? (
                  <Text variant="caption" color="inkMuted">
                    {reservation.spot.hoursNote}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text variant="label" weight="600">
                  {reservation.customAddress}
                </Text>
                <Text variant="caption" color="inkMuted">
                  Public places are safer for meeting someone new. Only share an address you&apos;re
                  comfortable with.
                </Text>
              </>
            )}
          </View>
        </View>
        <Divider style={styles.infoDivider} />
        <Text variant="caption" color="inkFaint">
          Reminder: reminders are not yet implemented in this prototype.
        </Text>
      </Card>

      <View style={styles.actionArea}>
        {actionError ? (
          <View style={styles.errorBanner}>
            <Text variant="body" color="danger">
              {actionError}
            </Text>
          </View>
        ) : null}

        {(reservation.status === 'requested' || reservation.status === 'countered') && !iProposed ? (
          <OpenActionsForResponder
            isSeller={isSeller}
            otherName={otherParty?.displayName ?? 'them'}
            accepting={acceptMutation.isPending}
            declining={declineMutation.isPending}
            cancelling={cancelMutation.isPending}
            onAccept={() => acceptMutation.mutate({ id: reservation.id })}
            onPropose={() => {
              setActionError(null);
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
            onChangeProposal={() => {
              setActionError(null);
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
            onConfirmTap={() => confirmHandoffMutation.mutate({ id: reservation.id })}
            onConfirmCode={(code) => confirmHandoffMutation.mutate({ id: reservation.id, code })}
            onReschedule={() => {
              setActionError(null);
              setProposeOpen(true);
            }}
            onCancel={() => {
              setActionError(null);
              setCancelOpen(true);
            }}
          />
        ) : null}

        {reservation.status === 'completed' ? (
          <CompletedActions onReport={() => setReportOpen(true)} />
        ) : null}

        {reservation.status === 'declined' || reservation.status === 'cancelled' || reservation.status === 'expired' ? (
          <ClosedActions status={reservation.status} reason={reservation.cancelReason} onMessage={goToConversation} />
        ) : null}
      </View>

      <ProposeSheet
        visible={proposeOpen}
        onClose={() => setProposeOpen(false)}
        listingId={reservation.listingId}
        currentSpotId={reservation.spotId}
        currentCustomAddress={reservation.customAddress}
        currentStartsAt={reservation.startsAt}
        timeZone={timeZone}
        onSubmit={(location, startsAt, note) => {
          counterMutation.mutate({ id: reservation.id, ...location, startsAt, note });
        }}
      />

      <CancelSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => confirmCancel(reason)}
        loading={cancelMutation.isPending}
      />

      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        loading={reportMutation.isPending}
        onSubmit={(reason, details) =>
          otherParty &&
          reportMutation.mutate({ targetUserId: otherParty.id, reason, details: details || undefined })
        }
      />
      </Screen>
    </KeyboardAvoidingView>
  );
}

/* --------------------------------------------------------- status actions */

function OpenActionsForResponder({
  isSeller,
  otherName,
  accepting,
  declining,
  cancelling,
  onAccept,
  onPropose,
  onDecline,
  onCancel,
}: {
  isSeller: boolean;
  otherName: string;
  accepting: boolean;
  declining: boolean;
  cancelling: boolean;
  onAccept: () => void;
  onPropose: () => void;
  onDecline: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.actionsGroup}>
      <Text variant="body" color="inkMuted">
        {otherName} proposed this meetup.
      </Text>
      <Button title="Accept" onPress={onAccept} loading={accepting} />
      <Button title="Propose another time" variant="secondary" onPress={onPropose} />
      {isSeller ? (
        <Button
          title="Decline"
          variant="ghost"
          onPress={() =>
            confirmAction('Decline this request?', 'The buyer will be notified.', 'Decline', onDecline, {
              cancelLabel: 'Keep it',
            })
          }
          loading={declining}
        />
      ) : (
        <Button
          title="Cancel request"
          variant="ghost"
          onPress={() =>
            confirmAction('Cancel this request?', undefined, 'Cancel request', onCancel, {
              cancelLabel: 'Keep it',
            })
          }
          loading={cancelling}
        />
      )}
    </View>
  );
}

function OpenActionsForProposer({
  otherName,
  cancelling,
  onChangeProposal,
  onCancel,
}: {
  otherName: string;
  cancelling: boolean;
  onChangeProposal: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.actionsGroup}>
      <Text variant="heading">Waiting for {otherName}</Text>
      <Text variant="body" color="inkMuted">
        You proposed this time. We&apos;ll let you know when they respond.
      </Text>
      <Button title="Change proposal" variant="secondary" onPress={onChangeProposal} />
      <Button
        title="Cancel"
        variant="ghost"
        onPress={() =>
          confirmAction('Cancel this request?', undefined, 'Cancel', onCancel, { cancelLabel: 'Keep it' })
        }
        loading={cancelling}
      />
    </View>
  );
}

function AcceptedActions({
  isBuyer,
  handoffCode,
  buyerConfirmedAt,
  sellerConfirmedAt,
  confirming,
  onConfirmTap,
  onConfirmCode,
  onReschedule,
  onCancel,
}: {
  isBuyer: boolean;
  handoffCode: string | null;
  buyerConfirmedAt: Date | null;
  sellerConfirmedAt: Date | null;
  confirming: boolean;
  onConfirmTap: () => void;
  onConfirmCode: (code: string) => void;
  onReschedule: () => void;
  onCancel: () => void;
}) {
  const [codeInput, setCodeInput] = useState('');

  return (
    <View style={styles.actionsGroup}>
      {isBuyer ? (
        <View style={styles.codeBlock}>
          <Text variant="label" color="inkMuted">
            Show this to the seller at pickup
          </Text>
          <Text variant="display" style={styles.codeText}>
            {handoffCode ?? '····'}
          </Text>
          <Button title="Confirm handoff" onPress={onConfirmTap} loading={confirming} disabled={!!buyerConfirmedAt} />
          {buyerConfirmedAt ? (
            <ConfirmedRow label="You confirmed" />
          ) : null}
          <ConfirmedOrWaitingRow confirmed={!!sellerConfirmedAt} label="Seller" />
        </View>
      ) : (
        <View style={styles.codeBlock}>
          <Text variant="label" color="inkMuted">
            Ask the buyer for their 4-digit code
          </Text>
          <TextInput
            value={codeInput}
            onChangeText={(t) => setCodeInput(t.replace(/[^0-9]/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="0000"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Buyer's handoff code"
            style={styles.codeInput}
          />
          <Button
            title="Confirm handoff"
            onPress={() => onConfirmCode(codeInput)}
            loading={confirming}
            disabled={codeInput.length !== 4 || !!sellerConfirmedAt}
          />
          {sellerConfirmedAt ? <ConfirmedRow label="You confirmed" /> : null}
          <ConfirmedOrWaitingRow confirmed={!!buyerConfirmedAt} label="Buyer" />
        </View>
      )}

      <View style={styles.rescheduleRow}>
        <Button title="Reschedule" variant="secondary" onPress={onReschedule} style={styles.halfBtn} />
        <Button title="Cancel meetup" variant="ghost" onPress={onCancel} style={styles.halfBtn} />
      </View>
    </View>
  );
}

function ConfirmedRow({ label }: { label: string }) {
  return (
    <View style={styles.confirmedRow}>
      <CheckCircle2 size={16} color={colors.success} />
      <Text variant="caption" color="success">
        {label}
      </Text>
    </View>
  );
}

function ConfirmedOrWaitingRow({ confirmed, label }: { confirmed: boolean; label: string }) {
  return (
    <View style={styles.confirmedRow}>
      {confirmed ? <CheckCircle2 size={16} color={colors.success} /> : null}
      <Text variant="caption" color={confirmed ? 'success' : 'inkFaint'}>
        {confirmed ? `${label} confirmed` : `Waiting on ${label.toLowerCase()}`}
      </Text>
    </View>
  );
}

function CompletedActions({ onReport }: { onReport: () => void }) {
  return (
    <View style={styles.actionsGroup}>
      <View style={styles.successRow}>
        <CheckCircle2 size={20} color={colors.success} />
        <Text variant="heading">Handed off — item marked sold</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onReport} style={styles.reportLink}>
        <Text variant="label" color="inkMuted" style={styles.reportLinkText}>
          Report a problem
        </Text>
      </Pressable>
    </View>
  );
}

function ClosedActions({
  status,
  reason,
  onMessage,
}: {
  status: 'declined' | 'cancelled' | 'expired';
  reason: string | null;
  onMessage: () => void;
}) {
  const copy: Record<typeof status, string> = {
    declined: 'The seller declined this request.',
    cancelled: 'This meetup was cancelled.',
    expired: 'This meetup request expired.',
  };

  return (
    <View style={styles.actionsGroup}>
      <Text variant="body" color="inkMuted">
        {copy[status]}
      </Text>
      {reason ? (
        <Text variant="caption" color="inkFaint" style={styles.reasonText}>
          Reason: {reason}
        </Text>
      ) : null}
      <Button title="Message" variant="secondary" onPress={onMessage} />
    </View>
  );
}

/* ----------------------------------------------------------------- sheets */

function ProposeSheet({
  visible,
  onClose,
  listingId,
  currentSpotId,
  currentCustomAddress,
  currentStartsAt,
  timeZone,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  listingId: string;
  currentSpotId: string | null;
  currentCustomAddress: string | null;
  currentStartsAt: Date;
  timeZone?: string;
  onSubmit: (location: { spotId: string } | { customAddress: string }, startsAt: Date, note?: string) => void;
}) {
  const listingQuery = trpc.listing.byId.useQuery({ id: listingId }, { enabled: visible });
  const [spotId, setSpotId] = useState<string | undefined>(currentSpotId ?? undefined);
  const [customAddress, setCustomAddress] = useState<ResolvedCustomAddress | null>(
    currentCustomAddress ? { address: currentCustomAddress, lat: 0, lng: 0, distanceMeters: 0 } : null,
  );
  const [startsIso, setStartsIso] = useState<string | undefined>(currentStartsAt.toISOString());
  const [note, setNote] = useState('');

  const canSubmit = (!!spotId || !!customAddress) && !!startsIso;

  return (
    <Sheet visible={visible} onClose={onClose} title="Propose a time">
      {listingQuery.isPending ? (
        <Skeleton height={160} />
      ) : listingQuery.isError ? (
        <ErrorState message={listingQuery.error.message} onRetry={() => listingQuery.refetch()} />
      ) : (
        <View style={styles.sheetContent}>
          <Text variant="label" color="inkMuted">
            Spot
          </Text>
          <SpotPicker
            spots={listingQuery.data.spots}
            selectedId={spotId}
            onSelect={setSpotId}
            campusId={listingQuery.data.campusId}
            customAddress={customAddress}
            onCustomAddressChange={(resolved) => {
              setCustomAddress(resolved);
              if (resolved) setSpotId(undefined);
            }}
          />

          <Text variant="label" color="inkMuted" style={styles.sheetSectionSpacing}>
            Time
          </Text>
          <TimeSlotPicker
            windows={listingQuery.data.availabilityWindows.map((w) => ({
              startsAt: w.startsAt.toISOString(),
              endsAt: w.endsAt.toISOString(),
            }))}
            selectedIso={startsIso}
            onSelect={setStartsIso}
            timeZone={timeZone}
          />

          <TextArea
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Anything the other person should know"
            style={styles.sheetSectionSpacing}
          />

          <Button
            title="Send proposal"
            onPress={() =>
              startsIso &&
              onSubmit(
                spotId ? { spotId } : { customAddress: customAddress!.address },
                new Date(startsIso),
                note,
              )
            }
            disabled={!canSubmit}
            style={styles.sheetSectionSpacing}
          />
        </View>
      )}
    </Sheet>
  );
}

function CancelSheet({
  visible,
  onClose,
  onConfirm,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');

  return (
    <Sheet visible={visible} onClose={onClose} title="Cancel this meetup?">
      <View style={styles.sheetContent}>
        <Text variant="body" color="inkMuted">
          The other person will be notified. The item goes back on the market.
        </Text>
        <TextArea
          label="Reason (optional)"
          value={reason}
          onChangeText={setReason}
          placeholder="Let them know why"
          style={styles.sheetSectionSpacing}
        />
        <Button
          title="Cancel meetup"
          variant="danger"
          onPress={() => onConfirm(reason)}
          loading={loading}
          style={styles.sheetSectionSpacing}
        />
      </View>
    </Sheet>
  );
}

function ReportSheet({
  visible,
  onClose,
  loading,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  onSubmit: (reason: ReportReason, details: string) => void;
}) {
  const [reason, setReason] = useState<ReportReason>('other');
  const [details, setDetails] = useState('');

  return (
    <Sheet visible={visible} onClose={onClose} title="Report a problem">
      <View style={styles.sheetContent}>
        <View style={styles.reasonChips}>
          {REPORT_REASONS.map((r) => (
            <Chip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
          ))}
        </View>
        <TextArea
          label="Details (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="What happened?"
          style={styles.sheetSectionSpacing}
        />
        <Button
          title="Send report"
          variant="danger"
          onPress={() => onSubmit(reason, details)}
          loading={loading}
          style={styles.sheetSectionSpacing}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flexFill: { flex: 1 },
  loadingWrap: { gap: space.md, padding: space.lg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.huge },
  paymentNote: { marginTop: -space.sm },
  infoCard: { gap: space.sm },
  infoRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  infoRowText: { flex: 1, gap: 2 },
  spotNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  infoDivider: { marginVertical: 2 },
  actionArea: { gap: space.md },
  errorBanner: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  actionsGroup: { gap: space.sm },
  codeBlock: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
  },
  codeText: { letterSpacing: 8 },
  codeInput: {
    minWidth: 140,
    minHeight: minTouchHeight,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 8,
    color: colors.ink,
    paddingHorizontal: space.md,
  },
  confirmedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rescheduleRow: { flexDirection: 'row', gap: space.sm },
  halfBtn: { flex: 1 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reportLink: { minHeight: minTouchHeight, justifyContent: 'center' },
  reportLinkText: { textDecorationLine: 'underline' },
  reasonText: { marginTop: -space.xs },
  sheetContent: { paddingBottom: space.xl, gap: space.xs },
  sheetSectionSpacing: { marginTop: space.md },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
