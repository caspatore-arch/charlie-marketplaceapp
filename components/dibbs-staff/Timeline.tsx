/**
 * Full history, oldest first, including internal staff notes (marked
 * "Staff note": never shown to the seller). Meetup times print in campus time.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { colors, radius, space } from '@/constants/theme';
import { exactMeetupTime, zoneAbbreviation } from '@/components/booking/time';
import { estimateText, eventLabel, formatCents, formatWhen, type StaffDetail } from './format';

const AMOUNT_KINDS = new Set(['estimate_sent']);
const SINGLE_AMOUNT_KINDS = new Set(['final_offer_sent', 'final_offer_revised', 'final_accepted']);

function actorText(e: StaffDetail['timeline'][number]): string {
  if (e.actor === 'seller') return 'Seller';
  if (e.actor === 'system') return 'System';
  return e.actorName ? `Dibbs: ${e.actorName}` : 'Dibbs staff';
}

export function Timeline({ events, timezone }: { events: StaffDetail['timeline']; timezone: string }) {
  const zone = zoneAbbreviation(timezone);
  return (
    <View style={styles.list} accessibilityRole="list">
      {events.map((e) => {
        const amount = AMOUNT_KINDS.has(e.kind)
          ? estimateText(e.lowCents, e.highCents)
          : SINGLE_AMOUNT_KINDS.has(e.kind) && e.lowCents != null
            ? formatCents(e.lowCents)
            : null;
        return (
          <View key={e.id} style={[styles.item, e.internal && styles.internal]} accessibilityRole="text">
            <View style={styles.head}>
              <Text variant="label" weight="600" style={styles.title}>
                {eventLabel(e.kind)}
              </Text>
              {e.internal ? <Badge kind="status" label="Staff note" tone="warning" /> : null}
            </View>
            <Text variant="caption" color="inkMuted">
              {`${actorText(e)} · ${formatWhen(e.createdAt)}`}
            </Text>
            {amount ? (
              <Text variant="label">{`${e.kind === 'estimate_sent' ? 'Estimate' : 'Amount'}: ${amount}${e.kind === 'estimate_sent' ? ' (subject to inspection)' : ''}`}</Text>
            ) : null}
            {e.startsAt ? (
              <Text variant="label">
                {`${exactMeetupTime(e.startsAt, timezone)}${zone ? ` ${zone}` : ''}${e.spotName ? ` · ${e.spotName}` : ''}`}
              </Text>
            ) : null}
            {e.message ? <Text variant="bodySm">{e.message}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  item: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  internal: { backgroundColor: colors.warningSoft },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  title: { flexShrink: 1 },
});

export default Timeline;
