/**
 * Sell-form availability-window editor. Shows the windows already added and
 * an "Add window" button that opens a Sheet to pick a day (next 7 days) and
 * a start/end time in 30-minute steps via chips — no native DateTimePicker,
 * per spec, to stay Expo Go friendly.
 *
 * Times are built in the device's local time zone. That matches what a
 * student picking "today, 3:00-4:00" expects to see; the campus's IANA time
 * zone (used elsewhere for display) isn't threaded through here since the
 * seller is presumed to be on campus when listing.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { colors, radius, space } from '@/constants/theme';

export interface WindowItem {
  key: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
}

export interface WindowEditorProps {
  windows: WindowItem[];
  onChange: (windows: WindowItem[]) => void;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `window-${Date.now()}-${keySeq}`;
}

const DAY_COUNT = 7;
const START_MIN = 7 * 60; // 7:00 AM
const END_MIN = 22 * 60; // 10:00 PM
const STEP_MIN = 30;

function buildDayOptions(): { label: string; date: Date }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: DAY_COUNT }).map((_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return { label, date };
  });
}

function buildTimeOptions(): { label: string; minutes: number }[] {
  const options: { label: string; minutes: number }[] = [];
  for (let m = START_MIN; m <= END_MIN; m += STEP_MIN) {
    const hours24 = Math.floor(m / 60);
    const mins = m % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    options.push({ label: `${hours12}:${mins.toString().padStart(2, '0')} ${period}`, minutes: m });
  }
  return options;
}

function formatWindowRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const now = new Date();
  const sameDay = start.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = start.toDateString() === tomorrow.toDateString();

  const dayLabel = sameDay
    ? 'Today'
    : isTomorrow
      ? 'Tomorrow'
      : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel}, ${startTime} – ${endTime}`;
}

export function WindowEditor({ windows, onChange }: WindowEditorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [startMinutes, setStartMinutes] = useState<number | null>(null);
  const [endMinutes, setEndMinutes] = useState<number | null>(null);

  const dayOptions = useMemo(buildDayOptions, []);
  const timeOptions = useMemo(buildTimeOptions, []);

  function openSheet() {
    setDayIndex(null);
    setStartMinutes(null);
    setEndMinutes(null);
    setSheetOpen(true);
  }

  function handleAdd() {
    if (dayIndex === null || startMinutes === null || endMinutes === null) return;
    const day = dayOptions[dayIndex]!.date;
    const start = new Date(day);
    start.setMinutes(startMinutes);
    const end = new Date(day);
    end.setMinutes(endMinutes);
    if (end <= start) return;

    onChange([...windows, { key: nextKey(), startsAt: start.toISOString(), endsAt: end.toISOString() }]);
    setSheetOpen(false);
  }

  function handleRemove(key: string) {
    onChange(windows.filter((w) => w.key !== key));
  }

  const canAdd = dayIndex !== null && startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;

  return (
    <View>
      {windows.length === 0 ? (
        <Text variant="body" color="inkMuted" style={styles.emptyHint}>
          No windows yet. Buyers can still request a time, and &ldquo;Pickup today&rdquo; visibility needs at
          least one window today.
        </Text>
      ) : (
        <View style={styles.list}>
          {windows.map((w) => (
            <View key={w.key} style={styles.row}>
              <Text variant="body" style={styles.rowText}>
                {formatWindowRange(w.startsAt, w.endsAt)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove this window"
                onPress={() => handleRemove(w.key)}
                hitSlop={8}
                style={styles.deleteButton}
              >
                <Trash2 size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Button
        title="Add window"
        variant="secondary"
        onPress={openSheet}
        icon={<Plus size={18} color={colors.ink} />}
        style={styles.addButton}
      />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Add a pickup window">
        <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
          <Text variant="label" color="inkMuted" style={styles.sectionLabel}>
            Day
          </Text>
          <View style={styles.chipWrap}>
            {dayOptions.map((d, i) => (
              <Chip key={i} label={d.label} selected={dayIndex === i} onPress={() => setDayIndex(i)} />
            ))}
          </View>

          <Text variant="label" color="inkMuted" style={styles.sectionLabel}>
            Start time
          </Text>
          <View style={styles.chipWrap}>
            {timeOptions.map((t) => (
              <Chip
                key={t.minutes}
                label={t.label}
                selected={startMinutes === t.minutes}
                onPress={() => {
                  setStartMinutes(t.minutes);
                  if (endMinutes !== null && endMinutes <= t.minutes) setEndMinutes(null);
                }}
              />
            ))}
          </View>

          <Text variant="label" color="inkMuted" style={styles.sectionLabel}>
            End time
          </Text>
          <View style={styles.chipWrap}>
            {timeOptions
              .filter((t) => startMinutes === null || t.minutes > startMinutes)
              .map((t) => (
                <Chip
                  key={t.minutes}
                  label={t.label}
                  selected={endMinutes === t.minutes}
                  onPress={() => setEndMinutes(t.minutes)}
                />
              ))}
          </View>

          <Button title="Add window" onPress={handleAdd} disabled={!canAdd} style={styles.confirmButton} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyHint: { marginBottom: space.md },
  list: { gap: space.sm, marginBottom: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    minHeight: 48,
  },
  rowText: { flex: 1 },
  deleteButton: { padding: space.xs },
  addButton: { alignSelf: 'flex-start' },
  sheetScroll: { maxHeight: 480 },
  sectionLabel: { marginTop: space.lg, marginBottom: space.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  confirmButton: { marginTop: space.xl },
});

export default WindowEditor;
