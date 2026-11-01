/**
 * What the buying team can do next, based on the request's current status
 * (mirrors backend/dibbs/rules.ts and runStaffAction; the server re-checks).
 * One form is open at a time. Every seller-visible or destructive action asks
 * for confirmation first. The form remembers the version it was opened at and
 * sends that as `expectedVersion`; if the request changes underneath (someone
 * else acted), the form closes so nothing stale is sent by accident.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button, type ButtonVariant } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { confirmAction } from '@/utils/confirm';
import { colors, radius, space } from '@/constants/theme';
import { exactMeetupTime, zoneAbbreviation } from '@/components/booking/time';
import type { RouterInputs } from '@/types';
import { CloseForm, EstimateForm, FinalOfferForm, MeetupForm, MessageForm } from './ActionForms';
import { OUTCOME_LABEL, estimateText, formatCents, isOpenStatus, type StaffDetail } from './format';

export type StaffActionInput = RouterInputs['dibbsStaff']['act']['action'];

export interface ActionError {
  message: string;
  conflict: boolean;
}

export interface ActionsPanelProps {
  detail: StaffDetail;
  busy: boolean;
  error: ActionError | null;
  onDismissError: () => void;
  /** Runs a state-changing action with the version the form was opened at. */
  onAct: (action: StaffActionInput, version: number, onDone: () => void) => void;
  onAddNote: (message: string, onDone: () => void) => void;
}

type Key =
  | 'start_review'
  | 'request_info'
  | 'estimate'
  | 'decline'
  | 'propose_meetup'
  | 'confirm_meetup'
  | 'cancel_meetup'
  | 'final_offer'
  | 'record_completed'
  | 'record_payout'
  | 'close'
  | 'note';

interface Entry {
  key: Key;
  title: string;
  variant: ButtonVariant;
}

const DECLINE_DEFAULT =
  'Thanks for sending this in. We can’t make an offer on this item right now. You’re welcome to send us other items any time.';

/** The actions that make sense now. Order is the order buttons appear. */
function entriesFor(d: StaffDetail): Entry[] {
  const out: Entry[] = [];
  const s = d.status;
  const sellerProposed = d.meetup?.proposedBy === 'seller';
  if (s === 'submitted') out.push({ key: 'start_review', title: 'Start review', variant: 'primary' });
  if (s === 'submitted' || s === 'in_review' || s === 'needs_info') {
    out.push({ key: 'estimate', title: 'Send estimate', variant: 'primary' });
    out.push({ key: 'request_info', title: 'Request info', variant: 'secondary' });
  }
  if (s === 'offered' || s === 'expired') {
    out.push({ key: 'estimate', title: 'Send revised estimate', variant: s === 'expired' ? 'primary' : 'secondary' });
  }
  if (s === 'offered') out.push({ key: 'propose_meetup', title: 'Propose meetup', variant: 'primary' });
  if (s === 'meetup_proposed' && sellerProposed) {
    out.push({ key: 'confirm_meetup', title: 'Confirm meetup', variant: 'primary' });
    out.push({ key: 'propose_meetup', title: 'Propose another time', variant: 'secondary' });
  }
  if (s === 'meetup_confirmed') {
    out.push({ key: 'final_offer', title: 'Record final offer', variant: 'primary' });
    out.push({ key: 'propose_meetup', title: 'Propose another time', variant: 'secondary' });
  }
  if (s === 'meetup_proposed' || s === 'meetup_confirmed') out.push({ key: 'cancel_meetup', title: 'Cancel meetup', variant: 'secondary' });
  if (s === 'final_offer') out.push({ key: 'final_offer', title: 'Revise final offer', variant: 'secondary' });
  if (s === 'final_accepted') out.push({ key: 'record_completed', title: 'Record handoff complete', variant: 'primary' });
  if (s === 'completed' && d.payoutStatus === 'not_recorded') {
    out.push({ key: 'record_payout', title: 'Record payout made outside the app', variant: 'primary' });
  }
  if (s === 'submitted' || s === 'in_review' || s === 'needs_info' || s === 'offered' || s === 'meetup_proposed') {
    out.push({ key: 'decline', title: 'Decline request', variant: 'secondary' });
  }
  if (isOpenStatus(s)) out.push({ key: 'close', title: 'Close with outcome', variant: 'secondary' });
  out.push({ key: 'note', title: 'Add staff note', variant: 'ghost' });
  return out;
}

/** A line saying who we are waiting on, when nothing is for staff to do. */
function waitingLine(d: StaffDetail): string | null {
  switch (d.status) {
    case 'needs_info':
      return 'Waiting for the seller to answer your question. You can still send an estimate.';
    case 'offered':
      return d.estimate ? `Waiting for the seller to answer the ${estimateText(d.estimate.lowCents, d.estimate.highCents)} estimate.` : 'Waiting for the seller to answer the estimate.';
    case 'expired':
      return 'The seller never answered, so the estimate lapsed. Send a revised estimate to start again.';
    case 'meetup_proposed':
      return d.meetup?.proposedBy === 'dibbs' ? 'Waiting for the seller to accept the meetup time you proposed.' : null;
    case 'final_offer':
      return d.finalOffer ? `Waiting for the seller to accept ${formatCents(d.finalOffer.cents)}.` : 'Waiting for the seller to accept the final offer.';
    case 'completed':
      return d.payoutStatus === 'recorded_outside_app' ? 'A payout made outside the app is already recorded.' : null;
    default:
      return null;
  }
}

export function ActionsPanel({ detail, busy, error, onDismissError, onAct, onAddNote }: ActionsPanelProps) {
  const [openState, setOpen] = useState<{ key: Key; title: string; version: number } | null>(null);

  // If the request changed while a form was open, drop the form rather than send stale values.
  const stale = !!openState && openState.version !== detail.version;
  const open = stale ? null : openState;

  const entries = entriesFor(detail);
  const waiting = waitingLine(detail);
  const tz = detail.timezone;
  const zone = zoneAbbreviation(tz);

  const openForm = (e: Entry) => {
    onDismissError();
    setOpen({ key: e.key, title: e.title, version: detail.version });
  };
  const close = () => setOpen(null);

  /** Confirm, then run. `version` is the version the form was opened at. */
  const run = (action: StaffActionInput, version: number, confirm: { title: string; message: string; label: string; destructive?: boolean } | null) => {
    const go = () => onAct(action, version, close);
    if (!confirm) return go();
    confirmAction(confirm.title, confirm.message, confirm.label, go, { destructive: confirm.destructive ?? false });
  };

  const immediate = (e: Entry) => {
    onDismissError();
    const v = detail.version;
    switch (e.key) {
      case 'start_review':
        return run({ type: 'start_review' }, v, null);
      case 'confirm_meetup':
        return run({ type: 'confirm_meetup' }, v, {
          title: 'Confirm this meetup?',
          message: `${detail.meetup ? `${exactMeetupTime(detail.meetup.startsAt, tz)}${zone ? ` ${zone}` : ''}` : 'The proposed time'}${detail.meetup?.spot ? ` at ${detail.meetup.spot.name}` : ''}. The seller is told it is confirmed.`,
          label: 'Confirm meetup',
        });
      case 'record_completed':
        return run({ type: 'record_completed' }, v, {
          title: 'Record the handoff as complete?',
          message: 'This records that the item changed hands. It does not mean any payment was sent.',
          label: 'Record handoff',
        });
      default:
        return openForm(e);
    }
  };

  const isImmediate = (k: Key) => k === 'start_review' || k === 'confirm_meetup' || k === 'record_completed';

  const form = (() => {
    if (!open) return null;
    const v = open.version;
    switch (open.key) {
      case 'request_info':
        return (
          <MessageForm
            title="Request more info"
            intro="Ask the seller one clear question. They are emailed and notified, and can answer with text or a photo."
            label="Your question"
            placeholder="Does it include the charger? Any scratches on the screen?"
            submitLabel="Send question"
            visibility="seller"
            busy={busy}
            onCancel={close}
            onSubmit={(message) =>
              run({ type: 'request_info', message }, v, {
                title: 'Send this question to the seller?',
                message,
                label: 'Send question',
                destructive: false,
              })
            }
          />
        );
      case 'estimate':
        return (
          <EstimateForm
            revising={detail.status === 'offered' || detail.status === 'expired'}
            busy={busy}
            onCancel={close}
            onSubmit={({ lowCents, highCents, message }) =>
              run({ type: 'send_estimate', lowCents, highCents, message }, v, {
                title: 'Send this estimate?',
                message: `The seller will see: Estimated ${estimateText(lowCents, highCents)}, subject to inspection. They are emailed and notified.`,
                label: 'Send estimate',
                destructive: false,
              })
            }
          />
        );
      case 'decline':
        return (
          <MessageForm
            title="Decline this request"
            intro="A polite no. Edit the message so it fits this item."
            label="Message to the seller"
            initial={DECLINE_DEFAULT}
            submitLabel="Decline request"
            visibility="seller"
            danger
            busy={busy}
            onCancel={close}
            onSubmit={(message) =>
              run({ type: 'decline', message }, v, {
                title: 'Decline this request?',
                message: 'The seller is told right away and the request is closed. This can’t be undone.',
                label: 'Decline',
                destructive: true,
              })
            }
          />
        );
      case 'propose_meetup':
        return (
          <MeetupForm
            campusId={detail.campusId}
            timezone={tz}
            title={open.title}
            busy={busy}
            onCancel={close}
            onSubmit={({ spotId, startsAt, spotName }) =>
              run({ type: 'propose_meetup', spotId, startsAt }, v, {
                title: 'Send this meetup time?',
                message: `${exactMeetupTime(startsAt, tz)}${zone ? ` ${zone}` : ''} at ${spotName}. The seller has to accept it.`,
                label: 'Send meetup time',
                destructive: false,
              })
            }
          />
        );
      case 'cancel_meetup':
        return (
          <MessageForm
            title="Cancel the meetup"
            intro="The request goes back to the estimate stage so a new time can be proposed. Any hold on a linked listing is released."
            label="Why? (the seller will read this)"
            placeholder="Something came up on our side. We’ll propose another time."
            submitLabel="Cancel meetup"
            visibility="seller"
            danger
            busy={busy}
            onCancel={close}
            onSubmit={(message) =>
              run({ type: 'cancel_meetup', message }, v, {
                title: 'Cancel this meetup?',
                message: 'The seller is told the meetup is cancelled.',
                label: 'Cancel meetup',
                destructive: true,
              })
            }
          />
        );
      case 'final_offer':
        return (
          <FinalOfferForm
            revising={detail.status === 'final_offer'}
            initialCents={detail.status === 'final_offer' ? detail.finalOffer?.cents : null}
            busy={busy}
            onCancel={close}
            onSubmit={({ amountCents, message }) =>
              run({ type: 'send_final_offer', amountCents, message }, v, {
                title: 'Send this final offer?',
                message: `${formatCents(amountCents)}. The seller has to accept it in their app before anything is agreed.`,
                label: 'Send final offer',
                destructive: false,
              })
            }
          />
        );
      case 'record_payout':
        return (
          <MessageForm
            title="Record a payout made outside the app"
            intro="The payout method isn’t decided yet and this app moves no money. Record only that you paid the seller yourself, with the method and amount."
            label="Method and amount (the seller will see this)"
            placeholder="Cash, $120"
            submitLabel="Record payout"
            visibility="seller"
            busy={busy}
            onCancel={close}
            onSubmit={(message) =>
              run({ type: 'record_payout', message }, v, {
                title: 'Record this payout?',
                message: 'This only records that you paid the seller outside the app. It can’t be edited afterwards.',
                label: 'Record payout',
                destructive: false,
              })
            }
          />
        );
      case 'close':
        return (
          <CloseForm
            busy={busy}
            onCancel={close}
            onSubmit={({ outcome, message }) =>
              run({ type: 'close', outcome, message }, v, {
                title: `Close as “${OUTCOME_LABEL[outcome]}”?`,
                message: 'The request ends and the seller is told. This can’t be undone.',
                label: 'Close request',
                destructive: true,
              })
            }
          />
        );
      case 'note':
        return (
          <MessageForm
            title="Add a staff note"
            intro="For the buying team only."
            label="Note"
            placeholder="Spoke to the seller in person, serial number checked."
            submitLabel="Save note"
            visibility="internal"
            busy={busy}
            onCancel={close}
            onSubmit={(message) => onAddNote(message, close)}
          />
        );
      default:
        return null;
    }
  })();

  // Shown under an open form (next to its submit button) so a failure is not scrolled out of sight.
  const errorBanner =
    error ? (
        <View style={[styles.banner, error.conflict ? styles.conflict : styles.failure]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Text variant="heading" color={error.conflict ? 'warning' : 'danger'}>
            {error.conflict ? 'Someone else updated this request' : 'That didn’t go through'}
          </Text>
          <Text variant="body">{error.message}</Text>
          {error.conflict ? (
            <Text variant="bodySm" color="inkMuted">
              The latest version has been loaded below. Check it, then try again if it still applies.
            </Text>
          ) : null}
          <Button title="Dismiss" variant="secondary" onPress={onDismissError} style={styles.dismiss} />
        </View>
      ) : null;

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        Actions
      </Text>

      {!form ? errorBanner : null}

      {stale ? (
        <View style={[styles.banner, styles.conflict]} accessibilityRole="alert">
          <Text variant="body">
            This request changed while you had a form open, so the form was closed. Check the latest and try again.
          </Text>
        </View>
      ) : null}

      {waiting ? (
        <Text variant="body" color="inkMuted">
          {waiting}
        </Text>
      ) : null}

      <View style={styles.buttons}>
        {entries.map((e) => (
          <Button
            key={`${e.key}:${e.title}`}
            title={e.title}
            variant={open?.key === e.key ? 'primary' : e.variant}
            disabled={busy}
            onPress={() => (isImmediate(e.key) ? immediate(e) : openForm(e))}
            style={styles.action}
          />
        ))}
      </View>

      {form}
      {form ? errorBanner : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 0 },
  banner: { gap: space.xs, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  conflict: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  failure: { backgroundColor: colors.accentSoft, borderColor: colors.danger },
  dismiss: { alignSelf: 'flex-start', marginTop: space.xs },
});

export default ActionsPanel;
