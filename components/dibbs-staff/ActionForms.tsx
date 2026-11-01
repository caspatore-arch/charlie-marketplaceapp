/**
 * Inline forms for the buying-team actions. Each form validates what it can on
 * the client (the server re-checks everything), shows exactly what the seller
 * will see, and hands a finished value to `onSubmit`. Confirmation dialogs and
 * the mutation itself live in ActionsPanel.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input, TextArea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { SpotPicker } from '@/components/SpotPicker';
import { ProposalTimePicker } from '@/components/reservation/ProposalTimePicker';
import { colors, radius, space } from '@/constants/theme';
import { exactMeetupTime, parseDollarsToCents, proposalSlotStarts, zoneAbbreviation } from '@/components/booking/time';
import { trpc } from '@/lib/trpc';
import { MAX_CENTS, OUTCOME_LABEL, estimateText, formatCents, type CloseOutcome } from './format';

interface FormShellProps {
  title: string;
  intro?: string;
  children: React.ReactNode;
}

export function FormShell({ title, intro, children }: FormShellProps) {
  return (
    <View style={styles.shell}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {intro ? (
        <Text variant="bodySm" color="inkMuted">
          {intro}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function FormButtons({
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  danger,
  disabled,
}: {
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.buttons}>
      <Button
        title={submitLabel}
        onPress={onSubmit}
        loading={busy}
        disabled={disabled}
        variant={danger ? 'danger' : 'primary'}
        style={styles.grow}
      />
      <Button title="Cancel" onPress={onCancel} variant="secondary" disabled={busy} />
    </View>
  );
}

function SellerSees({ children }: { children: string }) {
  return (
    <View style={styles.preview} accessibilityLiveRegion="polite">
      <Text variant="label" weight="600" color="accentInk">
        {children}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------- message */

export interface MessageFormProps {
  title: string;
  intro?: string;
  label: string;
  placeholder?: string;
  initial?: string;
  submitLabel: string;
  /** Who can read what is typed here. */
  visibility: 'seller' | 'internal';
  danger?: boolean;
  busy: boolean;
  onSubmit: (message: string) => void;
  onCancel: () => void;
}

export function MessageForm({
  title,
  intro,
  label,
  placeholder,
  initial = '',
  submitLabel,
  visibility,
  danger,
  busy,
  onSubmit,
  onCancel,
}: MessageFormProps) {
  const [text, setText] = useState(initial);
  const [tried, setTried] = useState(false);
  const trimmed = text.trim();
  const error = tried && !trimmed ? 'Write a message first.' : tried && trimmed.length > 1000 ? 'Keep it under 1,000 characters.' : undefined;

  const submit = () => {
    setTried(true);
    if (!trimmed || trimmed.length > 1000) return;
    onSubmit(trimmed);
  };

  return (
    <FormShell title={title} intro={intro}>
      <TextArea
        label={label}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        maxLength={1000}
        error={error}
        helper={visibility === 'seller' ? 'The seller will read this exactly as written.' : 'Internal only. The seller never sees this.'}
      />
      <FormButtons submitLabel={submitLabel} onSubmit={submit} onCancel={onCancel} busy={busy} danger={danger} />
    </FormShell>
  );
}

/* ------------------------------------------------------------ estimate */

export interface EstimateValue {
  lowCents: number;
  highCents: number;
  message?: string;
}

export function EstimateForm({
  revising,
  busy,
  onSubmit,
  onCancel,
}: {
  revising: boolean;
  busy: boolean;
  onSubmit: (value: EstimateValue) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'exact' | 'range'>('exact');
  const [exact, setExact] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);

  const result = useMemo(() => {
    const check = (text: string, name: string): { cents?: number; error?: string } => {
      const cents = parseDollarsToCents(text);
      if (cents == null) return { error: `Enter ${name} as a dollar amount, like 120 or 120.50.` };
      if (cents < 1) return { error: `${name[0]!.toUpperCase()}${name.slice(1)} must be more than $0.` };
      if (cents > MAX_CENTS) return { error: `Keep it at ${formatCents(MAX_CENTS)} or less.` };
      return { cents };
    };
    if (mode === 'exact') {
      const a = check(exact, 'the amount');
      return { lowCents: a.cents, highCents: a.cents, errors: { exact: a.error } as Record<string, string | undefined> };
    }
    const l = check(low, 'the low end');
    const h = check(high, 'the high end');
    const errors: Record<string, string | undefined> = { low: l.error, high: h.error };
    if (l.cents != null && h.cents != null && h.cents <= l.cents) {
      errors.high = 'The high end must be more than the low end. For one price, choose Exact.';
    }
    return { lowCents: l.cents, highCents: h.cents, errors };
  }, [mode, exact, low, high]);

  const valid = result.lowCents != null && result.highCents != null && Object.values(result.errors).every((e) => !e);
  const preview = valid ? estimateText(result.lowCents, result.highCents) : null;

  const submit = () => {
    setTried(true);
    if (!valid) return;
    onSubmit({ lowCents: result.lowCents!, highCents: result.highCents!, message: message.trim() || undefined });
  };

  return (
    <FormShell
      title={revising ? 'Send a revised estimate' : 'Send an estimate'}
      intro="Set by hand after looking at the photos. Every estimate is subject to inspection; the final offer comes after you see the item."
    >
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Estimate type">
        <Chip label="Exact price" selected={mode === 'exact'} onPress={() => setMode('exact')} />
        <Chip label="Price range" selected={mode === 'range'} onPress={() => setMode('range')} />
      </View>
      {mode === 'exact' ? (
        <Input
          label="Amount (US dollars)"
          value={exact}
          onChangeText={setExact}
          placeholder="120"
          keyboardType="decimal-pad"
          error={tried ? result.errors.exact : undefined}
        />
      ) : (
        <View style={styles.pair}>
          <View style={styles.grow}>
            <Input
              label="Low end ($)"
              value={low}
              onChangeText={setLow}
              placeholder="100"
              keyboardType="decimal-pad"
              error={tried ? result.errors.low : undefined}
            />
          </View>
          <View style={styles.grow}>
            <Input
              label="High end ($)"
              value={high}
              onChangeText={setHigh}
              placeholder="140"
              keyboardType="decimal-pad"
              error={tried ? result.errors.high : undefined}
            />
          </View>
        </View>
      )}
      <TextArea
        label="Message to the seller (optional)"
        value={message}
        onChangeText={setMessage}
        maxLength={1000}
        placeholder="What the price assumes, what you will check at the meetup."
        helper="The seller will read this."
      />
      {preview ? <SellerSees>{`Seller will see: Estimated ${preview}, subject to inspection`}</SellerSees> : null}
      <FormButtons submitLabel={revising ? 'Send revised estimate' : 'Send estimate'} onSubmit={submit} onCancel={onCancel} busy={busy} />
    </FormShell>
  );
}

/* --------------------------------------------------------- final offer */

export function FinalOfferForm({
  revising,
  initialCents,
  busy,
  onSubmit,
  onCancel,
}: {
  revising: boolean;
  initialCents?: number | null;
  busy: boolean;
  onSubmit: (value: { amountCents: number; message?: string }) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(initialCents ? (initialCents / 100).toFixed(2).replace(/\.00$/, '') : '');
  const [message, setMessage] = useState('');
  const [tried, setTried] = useState(false);

  const cents = parseDollarsToCents(amount);
  const error =
    cents == null
      ? 'Enter the amount as a dollar amount, like 120 or 120.50.'
      : cents < 1
        ? 'The amount must be more than $0.'
        : cents > MAX_CENTS
          ? `Keep it at ${formatCents(MAX_CENTS)} or less.`
          : undefined;

  const submit = () => {
    setTried(true);
    if (error || cents == null) return;
    onSubmit({ amountCents: cents, message: message.trim() || undefined });
  };

  return (
    <FormShell
      title={revising ? 'Revise the final offer' : 'Record the final offer'}
      intro="After inspecting the item. The seller has to accept this amount themselves in their app; nothing is agreed until they do."
    >
      <Input
        label="Final offer (US dollars)"
        value={amount}
        onChangeText={setAmount}
        placeholder="120"
        keyboardType="decimal-pad"
        error={tried ? error : undefined}
      />
      <TextArea
        label="Message to the seller (optional)"
        value={message}
        onChangeText={setMessage}
        maxLength={1000}
        placeholder="What you found at inspection, if the amount differs from the estimate."
        helper="The seller will read this."
      />
      {!error && cents != null ? <SellerSees>{`Seller will see: Final offer ${formatCents(cents)}, with Accept and Decline buttons`}</SellerSees> : null}
      <FormButtons submitLabel={revising ? 'Send revised final offer' : 'Send final offer'} onSubmit={submit} onCancel={onCancel} busy={busy} />
    </FormShell>
  );
}

/* -------------------------------------------------------------- meetup */

export function MeetupForm({
  campusId,
  timezone,
  title,
  busy,
  onSubmit,
  onCancel,
}: {
  campusId: string;
  timezone: string;
  title: string;
  busy: boolean;
  onSubmit: (value: { spotId: string; startsAt: Date; spotName: string }) => void;
  onCancel: () => void;
}) {
  const spotsQuery = trpc.campus.spots.useQuery({ campusId });
  const starts = useMemo(() => proposalSlotStarts(timezone), [timezone]);
  const [spotId, setSpotId] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const spot = spotsQuery.data?.find((s) => s.id === spotId);
  const zone = zoneAbbreviation(timezone);

  const submit = () => {
    setTried(true);
    if (!spot || !startsAt) return;
    onSubmit({ spotId: spot.id, startsAt: new Date(startsAt), spotName: spot.name });
  };

  return (
    <FormShell
      title={title}
      intro="Campus meetup spots only, on the 15-minute grid, within the next 7 days. Times are campus time. The seller has to accept before it is confirmed."
    >
      <View style={styles.block}>
        <Text variant="label" weight="600">
          Where
        </Text>
        {spotsQuery.isPending ? (
          <Skeleton height={64} />
        ) : spotsQuery.isError ? (
          <Text variant="body" color="danger" accessibilityRole="alert">
            {spotsQuery.error.message}
          </Text>
        ) : (
          <SpotPicker spots={spotsQuery.data} selectedId={spotId} onSelect={setSpotId} />
        )}
        {tried && !spot ? (
          <Text variant="caption" color="danger" accessibilityRole="alert">
            Pick a meetup spot.
          </Text>
        ) : null}
      </View>
      <View style={styles.block}>
        <Text variant="label" weight="600">
          When
        </Text>
        <ProposalTimePicker starts={starts} timeZone={timezone} selectedIso={startsAt} onSelect={setStartsAt} />
        {tried && !startsAt ? (
          <Text variant="caption" color="danger" accessibilityRole="alert">
            Pick a day and time.
          </Text>
        ) : null}
      </View>
      {spot && startsAt ? (
        <SellerSees>{`Seller will see: ${exactMeetupTime(startsAt, timezone)}${zone ? ` ${zone}` : ''} at ${spot.name}`}</SellerSees>
      ) : null}
      <FormButtons submitLabel="Send meetup time" onSubmit={submit} onCancel={onCancel} busy={busy} />
    </FormShell>
  );
}

/* --------------------------------------------------------------- close */

export function CloseForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (value: { outcome: CloseOutcome; message?: string }) => void;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const submit = () => {
    setTried(true);
    if (!outcome) return;
    onSubmit({ outcome, message: note.trim() || undefined });
  };

  return (
    <FormShell
      title="Close with an outcome"
      intro="Ends this request and releases any hold on a linked listing. The seller is told it was closed."
    >
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Outcome">
        {(Object.keys(OUTCOME_LABEL) as CloseOutcome[]).map((key) => (
          <Chip key={key} label={OUTCOME_LABEL[key]} selected={outcome === key} onPress={() => setOutcome(key)} />
        ))}
      </View>
      {tried && !outcome ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          Choose an outcome.
        </Text>
      ) : null}
      <TextArea
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        maxLength={1000}
        helper="The seller will read this note."
      />
      <FormButtons submitLabel="Close request" onSubmit={submit} onCancel={onCancel} busy={busy} danger />
    </FormShell>
  );
}

const styles = StyleSheet.create({
  shell: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 140 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  block: { gap: space.sm },
  preview: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.accentSoft },
});
