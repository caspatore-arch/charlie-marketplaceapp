/**
 * One private "Get a Dibbs offer" request (route `/dibbs-offer/[id]`), the page
 * a seller revisits as the Dibbs team replies. Shows, in plain words:
 *
 *   status headline -> the action for this state -> photos/video -> details
 *   -> updates timeline -> withdraw
 *
 * Actions by status (server rules in backend/trpc/routes/dibbsOffer.ts):
 *   needs_info       reply (+ more photos)
 *   offered          estimate: "Agree to meet" (time + place) or "No thanks"
 *   meetup_proposed  accept Dibbs's time, suggest another, or cancel
 *   meetup_confirmed reschedule or cancel
 *   final_offer      explicit Accept / Decline behind a confirmation that repeats the amount
 *
 * Wording rules: an estimate is subject to inspection, agreeing to meet is not
 * agreeing to a price, nothing is paid through the app, and a completed
 * handoff never implies a payment was sent.
 */
import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Video } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Divider } from '@/components/ui/Divider';
import { TextArea } from '@/components/ui/Input';
import { TextLink } from '@/components/ui/TextLink';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { RefetchBanner } from '@/components/ui/RefetchBanner';
import { ServerErrorNote, type ServerErrorLike } from '@/components/offers/ServerErrorNote';
import { PrivateMediaPicker, usePrivateMediaUploads } from '@/components/dibbs/PrivateMediaPicker';
import { MeetupPickerFlow } from '@/components/dibbs/MeetupPickerFlow';
import {
  campusDateTime,
  estimateText,
  formatDuration,
  isOpenStatus,
  money,
  statusCopy,
  timelineTitle,
  type DibbsOfferDetail,
} from '@/components/dibbs/status';
import { exactMeetupTime, shortDate, zoneAbbreviation } from '@/components/booking/time';
import { CONDITION_LABELS, type Condition } from '@/constants/campus';
import { colors, radius, space } from '@/constants/theme';
import { useAuth, useRequireAuth } from '@/hooks/useAuth';
import { resolveMediaUrl, trpc } from '@/lib/trpc';
import { MAX_REQUEST_PHOTOS, MAX_REQUEST_VIDEOS } from '@/lib/privateMedia';
import { confirmAction } from '@/utils/confirm';

type View_ = 'main' | 'agree' | 'suggest';

export default function DibbsOfferRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status: authStatus } = useAuth();
  const requireAuth = useRequireAuth();

  React.useEffect(() => {
    if (authStatus === 'signedOut' && id) requireAuth(`/dibbs-offer/${id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  const query = trpc.dibbsOffer.byId.useQuery({ id: id! }, { enabled: !!id && authStatus === 'signedIn' });
  const title = 'Dibbs offer request';

  if (!id) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorState message="No request chosen." />
      </Screen>
    );
  }
  if (authStatus !== 'signedIn' || query.isPending) {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title }} />
        <View style={styles.gap}>
          <Skeleton height={110} />
          <Skeleton height={170} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }
  if (query.isError && !query.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      </Screen>
    );
  }
  return (
    <Detail
      key={id}
      detail={query.data!}
      stale={query.isError}
      onRetry={() => query.refetch()}
    />
  );
}

/* ------------------------------------------------------------------ */

function Detail({ detail, stale, onRetry }: { detail: DibbsOfferDetail; stale: boolean; onRetry: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [view, setView] = useState<View_>('main');
  const [error, setError] = useState<ServerErrorLike | null>(null);
  const tz = detail.timezone;

  const copy = statusCopy({
    status: detail.status,
    closedOutcome: detail.closedOutcome,
    meetupProposedBy: detail.meetup?.proposedBy ?? null,
  });

  function applyDetail(next: DibbsOfferDetail) {
    utils.dibbsOffer.byId.setData({ id: detail.id }, next);
    void utils.dibbsOffer.mine.invalidate();
    void utils.dibbsOffer.forListing.invalidate();
    void utils.listing.byId.invalidate();
    void utils.listing.mine.invalidate();
    setError(null);
    setView('main');
  }
  function failed(err: ServerErrorLike) {
    setError(err);
    // Something changed under us (a revised estimate or offer): reload and show why.
    if (err.data?.code === 'CONFLICT') {
      void utils.dibbsOffer.byId.invalidate({ id: detail.id });
      setView('main');
    }
  }
  const opts = { onSuccess: applyDetail, onError: failed };
  const reply = trpc.dibbsOffer.reply.useMutation(opts);
  const declineEstimate = trpc.dibbsOffer.declineEstimate.useMutation(opts);
  const proposeMeetup = trpc.dibbsOffer.proposeMeetup.useMutation(opts);
  const acceptMeetup = trpc.dibbsOffer.acceptMeetup.useMutation(opts);
  const cancelMeetup = trpc.dibbsOffer.cancelMeetup.useMutation(opts);
  const respondToFinalOffer = trpc.dibbsOffer.respondToFinalOffer.useMutation(opts);
  const withdraw = trpc.dibbsOffer.withdraw.useMutation(opts);
  const busy =
    reply.isPending ||
    declineEstimate.isPending ||
    proposeMeetup.isPending ||
    acceptMeetup.isPending ||
    cancelMeetup.isPending ||
    respondToFinalOffer.isPending ||
    withdraw.isPending;

  /** Latest note the team attached to an event of this kind. */
  const lastNote = (...kinds: string[]) =>
    [...detail.timeline].reverse().find((e) => e.actor === 'staff' && kinds.includes(e.kind) && e.message)?.message ?? null;

  /* ---- time + place step ---- */
  if (view !== 'main' && detail.estimate) {
    const estimateVersion = detail.estimate.version;
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: view === 'agree' ? 'Agree to meet' : 'Suggest a time' }} />
        <MeetupPickerFlow
          campusId={detail.campusId}
          timeZone={tz}
          mode={view}
          submitting={proposeMeetup.isPending}
          error={error}
          onClearError={() => setError(null)}
          onCancel={() => {
            setError(null);
            setView('main');
          }}
          onSubmit={({ spotId, startsAtIso }) => {
            setError(null);
            proposeMeetup.mutate({ id: detail.id, spotId, startsAt: new Date(startsAtIso), estimateVersion });
          }}
        />
      </Screen>
    );
  }

  const meetup = detail.meetup;
  const finalCents = detail.finalOffer?.cents ?? null;

  function askDeclineEstimate() {
    if (!detail.estimate) return;
    const estimateVersion = detail.estimate.version;
    confirmAction(
      'Say no to this estimate?',
      'This closes the request. You can send a new one any time.',
      'No thanks',
      () => {
        setError(null);
        declineEstimate.mutate({ id: detail.id, estimateVersion });
      },
      { cancelLabel: 'Go back' },
    );
  }
  function askCancelMeetup() {
    confirmAction(
      'Cancel this meetup?',
      detail.estimate
        ? 'Your estimate stays open, and you can pick another time.'
        : 'You can pick another time later.',
      'Cancel meetup',
      () => {
        setError(null);
        cancelMeetup.mutate({ id: detail.id });
      },
      { cancelLabel: 'Keep meetup' },
    );
  }
  function askFinal(decision: 'accept' | 'decline') {
    if (!detail.finalOffer) return;
    const { cents, version } = detail.finalOffer;
    const send = () => {
      setError(null);
      respondToFinalOffer.mutate({ id: detail.id, finalOfferVersion: version, expectedCents: cents, decision });
    };
    if (decision === 'accept') {
      confirmAction(
        `Accept ${money(cents)}?`,
        `You’re accepting Dibbs’s final offer of ${money(cents)} for ${detail.itemName}. Dibbs will record the handoff. Nothing is paid through the app.`,
        `Accept ${money(cents)}`,
        send,
        { cancelLabel: 'Go back', destructive: false },
      );
    } else {
      confirmAction(
        `Decline ${money(cents)}?`,
        `You’re turning down Dibbs’s final offer of ${money(cents)}. This closes the request.`,
        'Decline',
        send,
        { cancelLabel: 'Go back' },
      );
    }
  }
  function askWithdraw() {
    confirmAction(
      'Withdraw this request?',
      'The Dibbs team stops working on it. You can send a new request any time.',
      'Withdraw request',
      () => {
        setError(null);
        withdraw.mutate({ id: detail.id });
      },
      { cancelLabel: 'Keep request' },
    );
  }

  const showMedia = detail.media.length > 0 || (detail.listing?.photoUrls.length ?? 0) > 0;
  const terminal = !isOpenStatus(detail.status);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Dibbs offer request' }} />
      {stale ? <RefetchBanner onRetry={onRetry} /> : null}

      {/* ---- Status ---- */}
      <View style={styles.gap} accessibilityRole="summary">
        <View style={styles.badgeRow}>
          <Badge kind="status" label={copy.label} tone={copy.tone} />
          {detail.sellerActionNeeded ? <Badge kind="status" label="Your turn" tone="warning" /> : null}
        </View>
        <Text variant="displaySm" accessibilityRole="header">
          {copy.headline}
        </Text>
        <Text variant="body" color="inkMuted">
          {copy.body}
        </Text>
        <Text variant="caption" color="inkFaint">
          Private: only you and authorized Dibbs staff can see this request.
        </Text>
      </View>

      {detail.listingOnHoldElsewhere && isOpenStatus(detail.status) ? (
        <View style={styles.note} accessibilityRole="text">
          <Text variant="bodySm">
            Your public listing is on hold for a buyer’s meetup, so Dibbs can’t confirm a meetup right now.
          </Text>
        </View>
      ) : null}

      <ServerErrorNote error={error} onDismiss={() => setError(null)} />

      {/* ---- Action for this state ---- */}
      {detail.status === 'needs_info' ? (
        <ReplyCard
          detail={detail}
          question={lastNote('info_requested')}
          sending={reply.isPending}
          onSend={(message, mediaIds) => {
            setError(null);
            reply.mutate({ id: detail.id, message, mediaIds });
          }}
        />
      ) : null}

      {detail.status === 'offered' && detail.estimate ? (
        <Card style={styles.gap}>
          <Text variant="label" color="inkMuted">
            {detail.estimate.kind === 'exact' ? 'Estimated offer' : 'Estimated range'}
          </Text>
          <Text variant="displaySm" accessibilityRole="header">
            {estimateText(detail.estimate.lowCents, detail.estimate.highCents)}
          </Text>
          <Text variant="body" weight="600">
            Subject to inspection
          </Text>
          {detail.estimate.expiresAt ? (
            <Text variant="bodySm" color="inkMuted">
              {`Open until ${campusDateTime(detail.estimate.expiresAt, tz)}`}
            </Text>
          ) : null}
          {lastNote('estimate_sent') ? <TeamNote text={lastNote('estimate_sent')!} /> : null}
          <Text variant="bodySm" color="inkMuted">
            Agreeing to meet isn’t agreeing to a final price. Dibbs confirms the price after inspecting the item, and you
            can still say no.
          </Text>
          <Button title="Agree to meet" size="lg" onPress={() => { setError(null); setView('agree'); }} disabled={busy} />
          <Button title="No thanks" variant="secondary" onPress={askDeclineEstimate} disabled={busy} loading={declineEstimate.isPending} />
        </Card>
      ) : null}

      {detail.status === 'meetup_proposed' && meetup ? (
        <Card style={styles.gap}>
          <Text variant="label" color="inkMuted">
            {meetup.proposedBy === 'dibbs' ? 'Dibbs suggested' : 'You suggested'}
          </Text>
          <MeetupDetails meetup={meetup} tz={tz} />
          {detail.estimate ? (
            <Text variant="bodySm" color="inkMuted">
              {`Estimate: ${estimateText(detail.estimate.lowCents, detail.estimate.highCents)}, subject to inspection. Meeting isn’t agreeing to a final price.`}
            </Text>
          ) : null}
          {meetup.proposedBy === 'dibbs' ? (
            <>
              <Button
                title="Accept"
                size="lg"
                onPress={() => {
                  setError(null);
                  acceptMeetup.mutate({ id: detail.id, expectedVersion: detail.version });
                }}
                loading={acceptMeetup.isPending}
                disabled={busy}
                accessibilityLabel="Accept the meetup time and place Dibbs suggested"
              />
              <Button title="Suggest another time" variant="secondary" onPress={() => { setError(null); setView('suggest'); }} disabled={busy} />
            </>
          ) : (
            <>
              <Text variant="body" weight="600">
                Waiting for Dibbs to confirm
              </Text>
              <Button title="Suggest another time" variant="secondary" onPress={() => { setError(null); setView('suggest'); }} disabled={busy} />
            </>
          )}
          <Button title="Cancel meetup" variant="ghost" onPress={askCancelMeetup} disabled={busy} loading={cancelMeetup.isPending} />
        </Card>
      ) : null}

      {detail.status === 'meetup_confirmed' && meetup ? (
        <Card style={styles.gap}>
          <Text variant="label" color="inkMuted">
            Your meetup
          </Text>
          <MeetupDetails meetup={meetup} tz={tz} />
          <Text variant="bodySm" color="inkMuted">
            Bring the item. Dibbs inspects it and then makes a final offer. You can still say no.
          </Text>
          <Button title="Reschedule" variant="secondary" onPress={() => { setError(null); setView('suggest'); }} disabled={busy} />
          <Text variant="caption" color="inkFaint">
            Rescheduling asks Dibbs to confirm the new time.
          </Text>
          <Button title="Cancel meetup" variant="ghost" onPress={askCancelMeetup} disabled={busy} loading={cancelMeetup.isPending} />
        </Card>
      ) : null}

      {detail.status === 'final_offer' && finalCents != null ? (
        <Card style={styles.gap}>
          <Text variant="displaySm" accessibilityRole="header">
            {`Dibbs’s final offer: ${money(finalCents)}`}
          </Text>
          <Text variant="body" color="inkMuted">
            This is the price after inspecting your item. Nothing is decided until you answer, and Dibbs never accepts for
            you.
          </Text>
          {lastNote('final_offer_sent', 'final_offer_revised') ? (
            <TeamNote text={lastNote('final_offer_sent', 'final_offer_revised')!} />
          ) : null}
          <Button
            title={`Accept ${money(finalCents)}`}
            size="lg"
            onPress={() => askFinal('accept')}
            disabled={busy}
            loading={respondToFinalOffer.isPending}
          />
          <Button title="Decline" variant="secondary" onPress={() => askFinal('decline')} disabled={busy} />
        </Card>
      ) : null}

      {detail.status === 'final_accepted' || detail.status === 'completed' ? (
        <Card style={styles.gap}>
          {detail.status === 'final_accepted' ? (
            <Text variant="heading">
              {`You accepted ${money(detail.finalAcceptedCents ?? finalCents ?? 0)}. Dibbs will record the handoff.`}
            </Text>
          ) : (
            <Text variant="heading">Handoff complete.</Text>
          )}
          {detail.status === 'completed' && detail.finalAcceptedCents != null ? (
            <Text variant="body" color="inkMuted">{`Agreed amount: ${money(detail.finalAcceptedCents)}.`}</Text>
          ) : null}
          <Text variant="bodySm" color="inkMuted">
            {detail.payoutStatus === 'recorded_outside_app'
              ? `Dibbs recorded a payout made outside the app${detail.payoutRecordedAt ? ` on ${shortDate(detail.payoutRecordedAt, tz)}` : ''}.`
              : 'How Dibbs pays you hasn’t been finalized; nothing is paid through the app.'}
          </Text>
        </Card>
      ) : null}

      {terminal && detail.status !== 'completed' ? (
        <View style={styles.gap}>
          <Button title="Request another offer" variant="secondary" onPress={() => router.push('/dibbs-offer/new')} />
          {detail.status !== 'closed' ? (
            <Button title="List it on Dibbs instead" variant="ghost" onPress={() => router.push('/listing/new?mode=list')} />
          ) : null}
        </View>
      ) : null}

      {/* ---- Photos and video ---- */}
      {showMedia ? (
        <View style={styles.gap}>
          <Text variant="title" accessibilityRole="header">
            {detail.media.length > 0 ? 'Photos and video' : 'Photos from your listing'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
            {detail.media.length > 0
              ? detail.media.map((m, i) =>
                  m.kind === 'image' ? (
                    <Image
                      key={m.id}
                      source={{ uri: resolveMediaUrl(m.url) }}
                      style={styles.tile}
                      contentFit="cover"
                      accessibilityLabel={`Photo ${detail.media.slice(0, i + 1).filter((x) => x.kind === 'image').length}`}
                    />
                  ) : (
                    <Pressable
                      key={m.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Play video${m.durationMs ? `, ${formatDuration(m.durationMs)}` : ''}. Opens in your browser.`}
                      onPress={() => {
                        const url = resolveMediaUrl(m.url);
                        if (url) {
                          Linking.openURL(url).catch(() =>
                            setError({ message: 'Couldn’t open the video. Try again.', data: null }),
                          );
                        }
                      }}
                      style={({ pressed }) => [styles.tile, styles.videoTile, pressed && styles.pressed]}
                    >
                      <Video size={30} color={colors.inkMuted} />
                      <Text variant="label" weight="600">
                        Play video
                      </Text>
                      {m.durationMs ? (
                        <Text variant="caption" color="inkMuted">
                          {formatDuration(m.durationMs)}
                        </Text>
                      ) : null}
                    </Pressable>
                  ),
                )
              : detail.listing!.photoUrls.map((u, i) => (
                  <Image
                    key={u}
                    source={{ uri: resolveMediaUrl(u) }}
                    style={styles.tile}
                    contentFit="cover"
                    accessibilityLabel={`Listing photo ${i + 1}`}
                  />
                ))}
          </ScrollView>
        </View>
      ) : null}

      {/* ---- Details ---- */}
      <View style={styles.gap}>
        <Text variant="title" accessibilityRole="header">
          Your request
        </Text>
        <Card style={styles.gap}>
          <Field label="Item" value={detail.itemName} />
          {detail.condition ? <Field label="Condition" value={CONDITION_LABELS[detail.condition as Condition] ?? detail.condition} /> : null}
          {detail.specs ? <Field label="Model or specifications" value={detail.specs} /> : null}
          {detail.description ? <Field label="Notes" value={detail.description} /> : null}
          <Field label="Sent" value={campusDateTime(detail.createdAt, tz)} />
          {detail.listing ? (
            <View style={styles.field}>
              <Text variant="caption" color="inkMuted">
                Also listed publicly as
              </Text>
              <TextLink onPress={() => router.push(`/listing/${detail.listing!.id}`)} accessibilityLabel={`Open your listing ${detail.listing.title}`}>
                {detail.listing.title}
              </TextLink>
            </View>
          ) : null}
        </Card>
      </View>

      {/* ---- Timeline ---- */}
      {detail.timeline.length > 0 ? (
        <View style={styles.gap}>
          <Text variant="title" accessibilityRole="header">
            Updates
          </Text>
          <Card style={styles.timeline}>
            {[...detail.timeline].reverse().map((e, i, all) => (
              <View key={e.id} style={styles.event}>
                <View style={styles.eventHead}>
                  <Text variant="label" weight="600">
                    {timelineTitle(e, tz)}
                  </Text>
                  <Text variant="caption" color="inkMuted">
                    {campusDateTime(e.createdAt, tz)}
                  </Text>
                </View>
                {e.message ? (
                  <Text variant="bodySm" color="inkMuted">
                    {`“${e.message}”`}
                  </Text>
                ) : null}
                {i < all.length - 1 ? <Divider style={styles.eventDivider} /> : null}
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {isOpenStatus(detail.status) ? (
        <Button
          title="Withdraw request"
          variant="ghost"
          onPress={askWithdraw}
          disabled={busy}
          loading={withdraw.isPending}
          accessibilityLabel="Withdraw this request"
        />
      ) : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function TeamNote({ text }: { text: string }) {
  return (
    <View style={styles.teamNote} accessible accessibilityLabel={`Note from Dibbs: ${text}`}>
      <Text variant="caption" color="inkMuted">
        Note from Dibbs
      </Text>
      <Text variant="body">{text}</Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" color="inkMuted">
        {label}
      </Text>
      <Text variant="body">{value}</Text>
    </View>
  );
}

function MeetupDetails({ meetup, tz }: { meetup: NonNullable<DibbsOfferDetail['meetup']>; tz: string }) {
  const zone = zoneAbbreviation(tz);
  return (
    <View style={styles.gap}>
      <View style={styles.field} accessible accessibilityLabel={`When: ${exactMeetupTime(meetup.startsAt, tz)}`}>
        <Text variant="caption" color="inkMuted">
          When
        </Text>
        <Text variant="heading">{exactMeetupTime(meetup.startsAt, tz)}</Text>
        {zone ? (
          <Text variant="caption" color="inkMuted">{`Campus time (${zone})`}</Text>
        ) : null}
      </View>
      {meetup.spot ? (
        <View style={styles.field} accessible accessibilityLabel={`Where: ${meetup.spot.name}. ${meetup.spot.description}`}>
          <Text variant="caption" color="inkMuted">
            Where
          </Text>
          <Text variant="heading">{meetup.spot.name}</Text>
          <Text variant="caption" color="inkMuted">
            {meetup.spot.description}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ReplyCard({
  detail,
  question,
  sending,
  onSend,
}: {
  detail: DibbsOfferDetail;
  question: string | null;
  sending: boolean;
  onSend: (message: string, mediaIds: string[]) => void;
}) {
  const [message, setMessage] = useState('');
  const existingPhotos = detail.media.filter((m) => m.kind === 'image').length;
  const existingVideos = detail.media.filter((m) => m.kind === 'video').length;
  const maxPhotos = Math.max(0, MAX_REQUEST_PHOTOS - existingPhotos);
  const maxVideos = Math.max(0, MAX_REQUEST_VIDEOS - existingVideos);
  const uploads = usePrivateMediaUploads({ maxPhotos, maxVideos });
  const canAddMedia = maxPhotos > 0 || maxVideos > 0;
  const hasAnswer = message.trim().length > 0 || uploads.doneIds.length > 0;
  const blockedBy = uploads.uploading
    ? 'Waiting for your uploads to finish.'
    : uploads.failed
      ? 'Try again or remove the photo that didn’t upload.'
      : !hasAnswer
        ? 'Write an answer or add a photo to continue.'
        : null;

  return (
    <Card style={styles.gap}>
      {question ? <TeamNote text={question} /> : null}
      <TextArea
        label="Your answer"
        value={message}
        onChangeText={setMessage}
        maxLength={1000}
        placeholder="Type your answer to Dibbs"
      />
      {canAddMedia ? (
        <View style={styles.gap}>
          <Text variant="label" color="inkMuted">
            Add photos (optional)
          </Text>
          <PrivateMediaPicker uploads={uploads} />
        </View>
      ) : null}
      <Button
        title="Send answer"
        size="lg"
        onPress={() => onSend(message.trim(), uploads.doneIds)}
        loading={sending}
        disabled={!!blockedBy}
        accessibilityLabel={blockedBy ? `Send answer. ${blockedBy}` : 'Send answer'}
      />
      {blockedBy ? (
        <Text variant="caption" color="inkMuted" style={styles.center}>
          {blockedBy}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl, paddingBottom: space.huge, paddingTop: space.lg },
  gap: { gap: space.md },
  center: { textAlign: 'center' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: space.md },
  teamNote: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md, gap: 2 },
  field: { gap: 2 },
  mediaRow: { gap: space.md, paddingVertical: space.xs },
  tile: { width: 140, height: 175, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  videoTile: { alignItems: 'center', justifyContent: 'center', gap: space.xs },
  pressed: { opacity: 0.8 },
  timeline: { gap: space.md },
  event: { gap: space.xs },
  eventHead: { gap: 2 },
  eventDivider: { marginTop: space.md },
});
