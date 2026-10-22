/** Plain-language list of what happened to a meetup, in campus time. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { exactMeetupTime, shortWhen, zoneAbbreviation } from '@/components/booking/time';
import { formatPrice } from '@/utils/format';
import { space } from '@/constants/theme';
import type { ReservationHistoryEvent } from '@/types';

export const EVENT_LABEL: Record<string, string> = {
  booked: 'Booked',
  requested: 'Time requested',
  countered: 'New time proposed',
  accepted: 'Time accepted',
  rescheduled: 'Time changed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  completed: 'Handed off',
  expired: 'Expired',
  imported: 'Earlier booking',
};

/** Never show a raw event name: fall back to a sentence-cased version. */
export function eventLabel(kind: string): string {
  if (EVENT_LABEL[kind]) return EVENT_LABEL[kind];
  const spaced = kind.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Update';
}

export function HistorySection({
  events,
  loading,
  timeZone,
}: {
  events: ReservationHistoryEvent[] | undefined;
  loading: boolean;
  timeZone?: string;
}) {
  if (loading) return <Skeleton height={48} />;
  if (!events || events.length === 0) return null;
  const zone = zoneAbbreviation(timeZone);
  return (
    <View style={styles.history} accessibilityLabel="Meetup history">
      <Text variant="heading">History</Text>
      {events.map((e) => (
        <View key={e.id} style={styles.historyRow}>
          <Text variant="label" weight="600">
            {eventLabel(e.kind)}
          </Text>
          <Text variant="caption" color="inkMuted" style={styles.when}>
            {shortWhen(e.createdAt, timeZone)}
            {zone ? ` ${zone}` : ''}
            {e.kind === 'booked' || e.kind === 'rescheduled' || e.kind === 'countered'
              ? ` · for ${exactMeetupTime(e.startsAt, timeZone).split(' – ')[0]} · ${formatPrice(e.priceCents)}`
              : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  history: { gap: space.sm },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  when: { flexShrink: 1, textAlign: 'right' },
});
