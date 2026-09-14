/**
 * Day tabs + 30-minute time-slot chips derived from a listing's availability
 * windows. Usage:
 * <TimeSlotPicker windows={listingDetail.availabilityWindows}
 *   selectedIso={startsAt} onSelect={setStartsAt} timeZone={campus.timezone} />
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { space } from '@/constants/theme';
import { Text } from './ui/Text';
import { Chip } from './ui/Chip';

export interface AvailabilityWindow {
  startsAt: string;
  endsAt: string;
}

export interface TimeSlotPickerProps {
  windows: AvailabilityWindow[];
  selectedIso?: string | null;
  onSelect: (iso: string) => void;
  timeZone?: string;
}

const SLOT_MINUTES = 30;

function dayKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  );
}

function dayLabel(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(
    date,
  );
}

function timeLabel(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}

export function TimeSlotPicker({ windows, selectedIso, onSelect, timeZone }: TimeSlotPickerProps) {
  const daysMap = useMemo(() => {
    const map = new Map<string, { label: string; slots: Date[] }>();
    for (const w of windows) {
      let cursor = new Date(w.startsAt);
      const end = new Date(w.endsAt);
      while (cursor < end) {
        const key = dayKey(cursor, timeZone);
        if (!map.has(key)) map.set(key, { label: dayLabel(cursor, timeZone), slots: [] });
        map.get(key)!.slots.push(new Date(cursor));
        cursor = new Date(cursor.getTime() + SLOT_MINUTES * 60_000);
      }
    }
    return map;
  }, [windows, timeZone]);

  const dayKeys = useMemo(() => Array.from(daysMap.keys()).sort(), [daysMap]);
  const [activeDay, setActiveDay] = useState<string | undefined>(dayKeys[0]);
  const effectiveDay = activeDay && daysMap.has(activeDay) ? activeDay : dayKeys[0];

  if (dayKeys.length === 0) {
    return (
      <Text variant="body" color="inkMuted">
        The seller hasn&apos;t added availability windows yet.
      </Text>
    );
  }

  const slots = effectiveDay ? daysMap.get(effectiveDay)?.slots ?? [] : [];

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayRow}>
        <View style={styles.chipRow}>
          {dayKeys.map((key) => (
            <Chip
              key={key}
              label={daysMap.get(key)!.label}
              selected={key === effectiveDay}
              onPress={() => setActiveDay(key)}
            />
          ))}
        </View>
      </ScrollView>
      <View style={styles.chipRow}>
        {slots.map((slot) => {
          const iso = slot.toISOString();
          return (
            <Chip
              key={iso}
              label={timeLabel(slot, timeZone)}
              selected={selectedIso === iso}
              onPress={() => onSelect(iso)}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  dayRow: { flexGrow: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

export default TimeSlotPicker;
