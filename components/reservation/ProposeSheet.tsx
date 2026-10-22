/** Sheet for proposing a different time/place on an open or booked meetup. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { SpotPicker, type ResolvedCustomAddress } from '@/components/SpotPicker';
import { TimeSlotPicker, type ChartSlot } from '@/components/TimeSlotPicker';
import { rollingDaySlotStarts } from '@/components/booking/time';
import { trpc } from '@/lib/trpc';
import { space } from '@/constants/theme';
import { ActionError } from './ActionError';

export function ProposeSheet({
  visible,
  onClose,
  listingId,
  currentSpotId,
  currentCustomAddress,
  currentStartsAt,
  timeZone,
  error,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  listingId: string;
  currentSpotId: string | null;
  currentCustomAddress: string | null;
  currentStartsAt: Date;
  timeZone?: string;
  error?: string | null;
  onSubmit: (location: { spotId: string } | { customAddress: string }, startsAt: Date, note?: string) => void;
}) {
  const listingQuery = trpc.listing.byId.useQuery({ id: listingId }, { enabled: visible });
  const slotsQuery = trpc.reservation.slots.useQuery({ listingId }, { enabled: visible });
  // While the listing is still open, offer its real availability chart. After
  // it expires (confirmed meetups outlive the listing) fall back to every
  // 15-minute step in the next 24 hours.
  const chart = slotsQuery.data;
  const chartSlots: ChartSlot[] = chart?.open && chart.slots.length > 0
    ? chart.slots
    : rollingDaySlotStarts().map((d) => ({ startsAt: d, available: true }));
  const currentIso = currentStartsAt.toISOString();
  const [spotId, setSpotId] = useState<string | undefined>(currentSpotId ?? undefined);
  const [customAddress, setCustomAddress] = useState<ResolvedCustomAddress | null>(
    currentCustomAddress ? { address: currentCustomAddress, lat: 0, lng: 0, distanceMeters: 0 } : null,
  );
  const [startsIso, setStartsIso] = useState<string | undefined>(currentStartsAt.toISOString());
  const [note, setNote] = useState('');

  const canSubmit = (!!spotId || !!customAddress) && !!startsIso;

  return (
    <Sheet visible={visible} onClose={onClose} title="Pick a new time">
      {listingQuery.isPending || slotsQuery.isPending ? (
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
            slots={chartSlots}
            selectedIso={startsIso}
            onSelect={setStartsIso}
            timeZone={chart?.timezone ?? timeZone}
            currentIso={currentIso}
          />

          <TextArea
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Anything the other person should know"
            style={styles.sheetSectionSpacing}
          />

          <View style={styles.sheetSectionSpacing}>
            <ActionError message={error} />
          </View>
          <Button
            title="Send new time"
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

const styles = StyleSheet.create({
  sheetContent: { paddingBottom: space.xl, gap: space.xs },
  sheetSectionSpacing: { marginTop: space.md },
});
