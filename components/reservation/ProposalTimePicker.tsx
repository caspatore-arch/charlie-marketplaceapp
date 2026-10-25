/**
 * Time picker for a buyer-proposed meetup on an archived listing: a day chooser
 * (up to 8 calendar days, since the window is 7 days from now) and, under it,
 * only the chosen day's 15-minute times. Showing one day at a time keeps the
 * screen to at most 64 time chips instead of several hundred.
 *
 * <ProposalTimePicker starts={proposalSlotStarts(tz)} timeZone={tz}
 *   selectedIso={startsAt} onSelect={setStartsAt} />
 *
 * All times are campus time; the zone abbreviation is printed by the picker.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { TimeSlotPicker } from '@/components/TimeSlotPicker';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';
import { dayKey, exactMeetupTime, relativeDayLabel, shortDate, zoneAbbreviation } from '@/components/booking/time';

export interface ProposalTimePickerProps {
  starts: Date[];
  timeZone?: string;
  selectedIso?: string | null;
  onSelect: (iso: string) => void;
}

interface Day {
  key: string;
  label: string;
  /** "Tue, Oct 27" */
  date: string;
  starts: Date[];
}

export function ProposalTimePicker({ starts, timeZone, selectedIso, onSelect }: ProposalTimePickerProps) {
  const days = useMemo(() => {
    const map = new Map<string, Day>();
    for (const d of starts) {
      const key = dayKey(d, timeZone);
      let day = map.get(key);
      if (!day) {
        day = { key, label: relativeDayLabel(d, timeZone), date: shortDate(d, timeZone), starts: [] };
        map.set(key, day);
      }
      day.starts.push(d);
    }
    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }, [starts, timeZone]);

  const [chosenKey, setChosenKey] = useState<string | undefined>();
  const selectedKey = selectedIso ? dayKey(selectedIso, timeZone) : undefined;
  const active = days.find((d) => d.key === chosenKey) ?? days.find((d) => d.key === selectedKey) ?? days[0];

  const slots = useMemo(() => (active ? active.starts.map((d) => ({ startsAt: d, available: true })) : []), [active]);

  if (!active) {
    return (
      <Text variant="body" color="inkMuted">
        No times to show.
      </Text>
    );
  }

  const zone = zoneAbbreviation(timeZone);

  return (
    <View style={styles.wrap}>
      <View style={styles.days} accessibilityRole="radiogroup" accessibilityLabel="Pick a day">
        {days.map((d) => {
          const selected = d.key === active.key;
          return (
            <Pressable
              key={d.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected }}
              accessibilityLabel={`${d.label}, ${d.date}${selected ? ', selected' : ''}`}
              onPress={() => setChosenKey(d.key)}
              style={({ pressed }) => [styles.day, selected && styles.daySelected, pressed && styles.pressed]}
            >
              <Text variant="label" weight="600" color={selected ? 'accentInk' : 'ink'}>
                {d.label}
              </Text>
              <Text variant="caption" color={selected ? 'accentInk' : 'inkMuted'}>
                {d.date.split(', ')[1] ?? d.date}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TimeSlotPicker slots={slots} timeZone={timeZone} selectedIso={selectedIso} onSelect={onSelect} />

      {selectedIso ? (
        <View style={styles.picked} accessibilityLiveRegion="polite">
          <Text variant="label" weight="600">
            {`Your pick: ${exactMeetupTime(selectedIso, timeZone)}${zone ? ` ${zone}` : ''}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  day: {
    minHeight: minTouchHeight + 8,
    minWidth: 72,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  daySelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.85 },
  picked: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
});

export default ProposalTimePicker;
