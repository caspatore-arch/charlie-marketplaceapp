/**
 * Availability editor for a listing. A listing is live for 24 hours, so every
 * window must sit between now and the listing's end (`until`). The seller adds
 * one or more windows (max 8, each at least 15 minutes); buyers then book one
 * 15-minute slot inside them.
 *
 * Times are real instants on quarter-hour boundaries and are displayed in the
 * campus timezone, so "Today / Tomorrow" and the clock match what buyers see.
 * No native date picker: day chips plus start/end chips keep it Expo Go and
 * web friendly.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Chip } from '@/components/ui/Chip';
import { colors, radius, space } from '@/constants/theme';
import { SLOT_MS, clockTime, dayKey, nextSlotBoundary, relativeDayLabel, shortDate } from '@/components/booking/time';

export interface WindowItem {
  key: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
}

export const MAX_WINDOWS = 8;

export interface WindowEditorProps {
  windows: WindowItem[];
  onChange: (windows: WindowItem[]) => void;
  /** End of the listing's life: now + 24h for a new listing, `expiresAt` when editing. */
  until: Date;
  /** Campus IANA timezone used to display times. */
  timeZone?: string;
  error?: string;
}

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `window-${Date.now()}-${keySeq}`;
}

/** Boundaries (:00/:15/:30/:45) from the next one until `until`, inclusive. */
function boundaries(until: Date): Date[] {
  const out: Date[] = [];
  for (let t = nextSlotBoundary().getTime(); t <= until.getTime(); t += SLOT_MS) out.push(new Date(t));
  return out;
}

export function WindowEditor({ windows, onChange, until, timeZone, error }: WindowEditorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  const untilMs = until.getTime();
  const all = useMemo(() => boundaries(new Date(untilMs)), [untilMs]);

  const days = useMemo(() => {
    const map = new Map<string, { label: string; sub: string }>();
    for (const b of all) {
      const k = dayKey(b, timeZone);
      if (!map.has(k)) map.set(k, { label: relativeDayLabel(b, timeZone), sub: shortDate(b, timeZone) });
    }
    return [...map.entries()];
  }, [all, timeZone]);

  // Starts must leave room for a 15-minute meetup before the end of the listing.
  const startOptions = all.filter((b) => dayKey(b, timeZone) === day && b.getTime() + SLOT_MS <= untilMs);
  const endOptions = start
    ? all.filter((b) => b.getTime() >= new Date(start).getTime() + SLOT_MS && b.getTime() <= untilMs)
    : [];

  const quick = useMemo(() => {
    const first = nextSlotBoundary().getTime();
    const candidates = [
      { label: 'Next 2 hours', hours: 2 },
      { label: 'Next 4 hours', hours: 4 },
      { label: 'Next 8 hours', hours: 8 },
    ];
    return candidates
      .map((c) => {
        const e = Math.min(first + c.hours * 3_600_000, untilMs);
        return { label: c.label, startsAt: new Date(first).toISOString(), endsAt: new Date(e).toISOString(), ok: e - first >= SLOT_MS };
      })
      .filter((c) => c.ok && !windows.some((w) => w.startsAt === c.startsAt && w.endsAt === c.endsAt));
  }, [windows, untilMs]);

  const hourly = all.filter((t) => t.getTime() % 3_600_000 === 0 && t.getTime() + 3_600_000 <= untilMs);
  const full = windows.length >= MAX_WINDOWS;

  function openSheet() {
    setDay(days[0]?.[0] ?? null);
    setStart(null);
    setEnd(null);
    setSheetOpen(true);
  }

  function handleAdd() {
    if (!start || !end) return;
    onChange([...windows, { key: nextKey(), startsAt: start, endsAt: end }]);
    setSheetOpen(false);
  }

  const sorted = [...windows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <View>
      <Text variant="body" color="inkMuted" style={styles.hint}>
        Your listing is live for 24 hours. Buyers book one of these times.
      </Text>

      {sorted.length === 0 ? (
        <Text variant="body" color={error ? 'danger' : 'inkMuted'} style={styles.hint} accessibilityRole={error ? 'alert' : undefined}>
          {error ?? 'Add at least one time you can meet in the next 24 hours.'}
        </Text>
      ) : (
        <View style={styles.list}>
          {sorted.map((w) => (
            <View key={w.key} style={styles.row}>
              <Text variant="body" style={styles.rowText}>
                {relativeDayLabel(w.startsAt, timeZone)}, {clockTime(w.startsAt, timeZone)} – {clockTime(w.endsAt, timeZone)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove window ${relativeDayLabel(w.startsAt, timeZone)} ${clockTime(w.startsAt, timeZone)}`}
                onPress={() => onChange(windows.filter((x) => x.key !== w.key))}
                hitSlop={14}
                style={styles.deleteButton}
              >
                <Trash2 size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Text variant="heading">Pick your available hours</Text>
      <Text variant="caption" color="inkMuted" style={styles.hint}>Times shown in {timeZone ?? 'your local timezone'}. Each hour gives buyers four 15-minute meetup slots. Tap an hour again to remove it.</Text>
      <View style={styles.quickWrap}>
        {hourly.map((t) => {
          const startsAt = t.toISOString();
          const endsAt = new Date(t.getTime() + 3_600_000).toISOString();
          const selected = windows.find((w) => w.startsAt === startsAt && w.endsAt === endsAt);
          const overlaps = windows.some((w) => new Date(w.startsAt).getTime() < t.getTime() + 3_600_000 && new Date(w.endsAt).getTime() > t.getTime());
          return <Chip key={startsAt} label={`${relativeDayLabel(t, timeZone)} ${clockTime(t, timeZone)}`} selected={!!selected}
            disabled={!selected && (full || overlaps)}
            onPress={() => onChange(selected ? windows.filter((w) => w.key !== selected.key) : [...windows, { key: nextKey(), startsAt, endsAt }])} />;
        })}
      </View>
      {quick.length > 0 && !full ? (
        <View style={styles.quickWrap}>
          {quick.map((o) => (
            <Chip
              key={o.label}
              label={o.label}
              onPress={() => onChange([...windows, { key: nextKey(), startsAt: o.startsAt, endsAt: o.endsAt }])}
              accessibilityLabel={`Add window: ${o.label}`}
            />
          ))}
        </View>
      ) : null}

      <Button
        title={windows.length > 0 ? 'Add another time' : 'Pick a custom time'}
        variant="secondary"
        onPress={openSheet}
        disabled={full || all.length < 2}
        icon={<Plus size={18} color={colors.ink} />}
        style={styles.addButton}
      />
      {full ? (
        <Text variant="caption" color="inkMuted" style={styles.hint}>
          Up to {MAX_WINDOWS} windows.
        </Text>
      ) : null}
      {all.length < 2 ? (
        <Text variant="caption" color="inkMuted" style={styles.hint}>
          Not enough time left on this listing to add a window.
        </Text>
      ) : null}

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Add a meetup window">
        <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
          <Text variant="label" color="inkMuted" style={styles.sectionLabel}>
            Day
          </Text>
          <View style={styles.chipWrap}>
            {days.map(([k, d]) => (
              <Chip
                key={k}
                label={`${d.label} · ${d.sub}`}
                selected={day === k}
                onPress={() => {
                  setDay(k);
                  setStart(null);
                  setEnd(null);
                }}
              />
            ))}
          </View>

          <Text variant="label" color="inkMuted" style={styles.sectionLabel}>
            Start time
          </Text>
          <View style={styles.chipWrap}>
            {startOptions.map((t) => {
              const iso = t.toISOString();
              return (
                <Chip
                  key={iso}
                  label={clockTime(t, timeZone)}
                  selected={start === iso}
                  onPress={() => {
                    setStart(iso);
                    if (end && new Date(end).getTime() < t.getTime() + SLOT_MS) setEnd(null);
                  }}
                />
              );
            })}
            {startOptions.length === 0 ? (
              <Text variant="caption" color="inkMuted">
                Nothing left on this day.
              </Text>
            ) : null}
          </View>

          <Text variant="label" color="inkMuted" style={styles.sectionLabel}>
            End time (at least 15 minutes later)
          </Text>
          <View style={styles.chipWrap}>
            {endOptions.map((t) => {
              const iso = t.toISOString();
              const sameDay = dayKey(t, timeZone) === day;
              return (
                <Chip
                  key={iso}
                  label={sameDay ? clockTime(t, timeZone) : `${relativeDayLabel(t, timeZone)} ${clockTime(t, timeZone)}`}
                  selected={end === iso}
                  onPress={() => setEnd(iso)}
                />
              );
            })}
            {!start ? (
              <Text variant="caption" color="inkMuted">
                Pick a start time first.
              </Text>
            ) : null}
          </View>

          <Button title="Add window" onPress={handleAdd} disabled={!start || !end} style={styles.confirmButton} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: space.md },
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
  deleteButton: { padding: space.sm },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  addButton: { alignSelf: 'flex-start' },
  sheetScroll: { maxHeight: 480 },
  sectionLabel: { marginTop: space.lg, marginBottom: space.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  confirmButton: { marginTop: space.xl },
});

export default WindowEditor;
