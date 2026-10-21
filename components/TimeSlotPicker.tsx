/**
 * The time-slot chart: 30-minute chips grouped by campus-local day
 * ("Today", "Tomorrow"). Unavailable slots stay visible but disabled, with a
 * reason, so a buyer sees *why* a time is missing instead of wondering.
 *
 * <TimeSlotPicker slots={chart.slots} timeZone={chart.timezone}
 *   selectedIso={startsAt} onSelect={setStartsAt} />
 *
 * `slots` come straight from `reservation.slots` (Date or ISO string starts).
 * `currentIso` marks the time of a meetup being rescheduled.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/constants/theme';
import { Text } from './ui/Text';
import { Chip } from './ui/Chip';
import { clockTime, dayKey, relativeDayLabel, shortDate, zoneAbbreviation } from '@/components/booking/time';

export interface ChartSlot {
  startsAt: Date | string;
  available: boolean;
  reason?: 'seller_busy' | 'you_busy' | null;
}

export interface TimeSlotPickerProps {
  slots: ChartSlot[];
  selectedIso?: string | null;
  onSelect: (iso: string) => void;
  timeZone?: string;
  currentIso?: string | null;
}

const REASON_LABEL = { seller_busy: 'Seller busy', you_busy: 'You have a meetup' } as const;

export function TimeSlotPicker({ slots, selectedIso, onSelect, timeZone, currentIso }: TimeSlotPickerProps) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; date: string; items: { iso: string; slot: ChartSlot }[] }>();
    const sorted = [...slots].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    for (const slot of sorted) {
      const d = new Date(slot.startsAt);
      const key = dayKey(d, timeZone);
      if (!map.has(key)) {
        map.set(key, { label: relativeDayLabel(d, timeZone), date: shortDate(d, timeZone), items: [] });
      }
      map.get(key)!.items.push({ iso: d.toISOString(), slot });
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, g]) => g);
  }, [slots, timeZone]);

  if (groups.length === 0) {
    return (
      <Text variant="body" color="inkMuted">
        No times to show.
      </Text>
    );
  }

  const zone = zoneAbbreviation(timeZone);

  return (
    <View style={styles.wrap}>
      {groups.map((g) => (
        <View key={g.date + g.label} style={styles.group}>
          <View style={styles.groupHeader}>
            <Text variant="heading">{g.label}</Text>
            <Text variant="caption" color="inkMuted">
              {g.date}
              {zone ? ` · ${zone}` : ''}
            </Text>
          </View>
          <View style={styles.chipRow}>
            {g.items.map(({ iso, slot }) => {
              const isCurrent = currentIso === iso;
              const disabled = !slot.available || isCurrent;
              const reason = isCurrent ? 'Current time' : slot.reason ? REASON_LABEL[slot.reason] : 'Unavailable';
              const label = clockTime(iso, timeZone);
              return (
                <View key={iso} style={styles.cell}>
                  <Chip
                    label={label}
                    selected={selectedIso === iso}
                    disabled={disabled}
                    onPress={() => onSelect(iso)}
                    accessibilityLabel={
                      disabled
                        ? `${g.label} ${label}, unavailable: ${reason}`
                        : `${g.label} ${label}${selectedIso === iso ? ', selected' : ''}`
                    }
                  />
                  {disabled ? (
                    <Text variant="caption" color="inkFaint" style={styles.reason} numberOfLines={1}>
                      {reason}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  group: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { alignItems: 'center', gap: 2 },
  reason: { fontSize: 11, maxWidth: 96 },
});

export default TimeSlotPicker;
