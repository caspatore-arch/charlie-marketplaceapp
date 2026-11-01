/**
 * Time + place steps for a Dibbs offer meetup (agree to meet, or suggest another
 * time). Same structure as `app/reservation/propose.tsx`: pick a campus time
 * (next 7 days) and a campus meetup spot, then confirm in plain words.
 * Campus spots only: no custom address, no shipping, no home pickup.
 *
 * Agreeing to meet is NOT agreeing to a final price; the confirm step says so.
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { DemoBadge } from '@/components/DemoBadge';
import { SpotPicker } from '@/components/SpotPicker';
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
import { trpc } from '@/lib/trpc';
import { space } from '@/constants/theme';

export interface MeetupPickerFlowProps {
  campusId: string;
  timeZone: string;
  mode: 'agree' | 'suggest';
  submitting: boolean;
  error: ServerErrorLike | null;
  onClearError: () => void;
  onSubmit: (v: { spotId: string; startsAtIso: string }) => void;
  onCancel: () => void;
}

/** "today (Sun, Oct 25) at 3:00 PM MST" / "on Tue, Oct 27 at 3:00 PM MST". */
function whenPhrase(iso: string, timeZone?: string): string {
  const day = relativeDayLabel(iso, timeZone);
  const date = shortDate(iso, timeZone);
  const zone = zoneAbbreviation(timeZone);
  const dayPart = day === 'Today' || day === 'Tomorrow' ? `${day.toLowerCase()} (${date})` : `on ${date}`;
  return `${dayPart} at ${clockTime(iso, timeZone)}${zone ? ` ${zone}` : ''}`;
}

export function MeetupPickerFlow({
  campusId,
  timeZone,
  mode,
  submitting,
  error,
  onClearError,
  onSubmit,
  onCancel,
}: MeetupPickerFlowProps) {
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [startsAt, setStartsAt] = useState<string | undefined>();
  const [spotId, setSpotId] = useState<string | undefined>();
  const [localError, setLocalError] = useState<ServerErrorLike | null>(null);
  // Fixed when the step opens so the list of times doesn't shift while choosing.
  const [openedAt] = useState(() => Date.now());

  const spotsQuery = trpc.campus.spots.useQuery({ campusId });
  const spots = useMemo(() => spotsQuery.data ?? [], [spotsQuery.data]);
  const starts = useMemo(() => proposalSlotStarts(timeZone, new Date(openedAt)), [timeZone, openedAt]);

  const selectedSpot = spots.find((s) => s.id === spotId);
  const pickedStart = startsAt && starts.some((d) => d.toISOString() === startsAt) ? startsAt : undefined;
  const ready = !!pickedStart && !!selectedSpot;
  const zone = zoneAbbreviation(timeZone);
  const shownError = error ?? localError;

  function review() {
    if (!ready) return;
    if (new Date(pickedStart!).getTime() <= Date.now()) {
      setStartsAt(undefined);
      setLocalError({ message: 'That time has already passed. Pick a later one.', data: { code: 'BAD_REQUEST' } });
      return;
    }
    setLocalError(null);
    onClearError();
    setStep('confirm');
  }

  if (step === 'confirm' && ready) {
    return (
      <View style={styles.wrap}>
        <Text variant="title" accessibilityRole="header">
          {mode === 'agree' ? 'Confirm you’ll meet' : 'Confirm the new time'}
        </Text>
        <Card style={styles.gap}>
          <Text variant="heading">
            {`You’re suggesting to meet Dibbs at ${selectedSpot!.name} ${whenPhrase(pickedStart!, timeZone)}.`}
          </Text>
          <Divider />
          <Row label="When" value={exactMeetupTime(pickedStart!, timeZone)} sub={zone ? `Campus time (${zone})` : undefined} />
          <Row label="Where" value={selectedSpot!.name} sub={selectedSpot!.description} demo={selectedSpot!.isDemo} />
        </Card>
        <Text variant="body" color="inkMuted">
          Dibbs confirms the time, and nothing is booked until they do. Meeting isn’t agreeing to a final price: Dibbs
          inspects the item at the meetup, then makes a final offer, and you can still say no.
        </Text>
        <ServerErrorNote error={shownError} />
        <Button
          title={mode === 'agree' ? 'Agree to meet' : 'Send this time'}
          size="lg"
          onPress={() => onSubmit({ spotId: selectedSpot!.id, startsAtIso: pickedStart! })}
          loading={submitting}
        />
        <Button
          title="Change time or place"
          variant="ghost"
          onPress={() => {
            onClearError();
            setStep('pick');
          }}
          disabled={submitting}
        />
      </View>
    );
  }

  const missing = !pickedStart && !selectedSpot ? 'a time and a place' : !pickedStart ? 'a time' : 'a place';
  return (
    <View style={styles.wrap}>
      <Text variant="title" accessibilityRole="header">
        {mode === 'agree' ? 'Pick a time and place' : 'Suggest another time'}
      </Text>
      <Text variant="body" color="inkMuted">
        {mode === 'agree'
          ? 'You’ll meet a Dibbs team member at a campus meetup spot. They inspect the item, then make a final offer.'
          : 'Pick a new time and place. Dibbs confirms before anything is booked.'}
      </Text>

      <ServerErrorNote error={shownError} />

      <View style={styles.section}>
        <Text variant="heading" accessibilityRole="header">
          Pick a time
        </Text>
        <Text variant="caption" color="inkMuted">
          15-minute meetups in campus time{zone ? ` (${zone})` : ''}, between 7 AM and 11 PM, in the next 7 days.
        </Text>
        <ProposalTimePicker
          starts={starts}
          timeZone={timeZone}
          selectedIso={pickedStart}
          onSelect={(iso) => {
            setLocalError(null);
            onClearError();
            setStartsAt(iso);
          }}
        />
      </View>

      <View style={styles.section}>
        <Text variant="heading" accessibilityRole="header">
          Pick a place
        </Text>
        {spotsQuery.isPending ? (
          <Skeleton height={120} />
        ) : spotsQuery.isError ? (
          <ErrorState message={spotsQuery.error.message} onRetry={() => spotsQuery.refetch()} />
        ) : spots.length === 0 ? (
          <Text variant="body" color="inkMuted">
            No campus meetup places are listed right now. Try again later.
          </Text>
        ) : (
          <SpotPicker
            spots={spots}
            selectedId={spotId}
            onSelect={(id) => {
              setLocalError(null);
              onClearError();
              setSpotId(id);
            }}
          />
        )}
      </View>

      <Button
        title="Review"
        size="lg"
        onPress={review}
        disabled={!ready}
        accessibilityLabel={ready ? 'Review' : `Review. Pick ${missing} first.`}
      />
      {!ready ? (
        <Text variant="caption" color="inkMuted" style={styles.hint}>
          {`Pick ${missing} to continue.`}
        </Text>
      ) : null}
      <Button title="Back" variant="ghost" onPress={onCancel} />
    </View>
  );
}

function Row({ label, value, sub, demo }: { label: string; value: string; sub?: string; demo?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}${sub ? `. ${sub}` : ''}`}>
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
  wrap: { gap: space.xl },
  gap: { gap: space.md },
  section: { gap: space.md },
  row: { gap: 2 },
  valueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  valueText: { flexShrink: 1 },
  hint: { textAlign: 'center', marginTop: -space.md },
});

export default MeetupPickerFlow;
