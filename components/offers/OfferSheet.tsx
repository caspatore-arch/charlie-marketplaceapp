/**
 * Buyer's "Make an offer" sheet. One sheet, one decision: price AND when/where.
 *
 * The seller's real availability windows (future only) are tappable choices;
 * picking a window narrows to 15-minute times inside it; the seller's chosen
 * spots are choices too. Sensible defaults (first window, first time, first
 * spot) mean the obvious proposal is two taps: type a price, send. A summary
 * line shows price + time + place together before sending. The server
 * re-checks the time and spot against the seller's real windows and spots.
 *
 * Amount in dollars -> cents; at least $1 and below the asking price.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { Input, TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ServerErrorNote, type ServerErrorLike } from './ServerErrorNote';
import { ChoiceChip } from './ChoiceChip';
import {
  DAY_MS,
  SLOT_MS,
  clockTime,
  exactMeetupTime,
  parseDollarsToCents,
  relativeDayLabel,
} from '@/components/booking/time';
import { colors, radius, space } from '@/constants/theme';
import { formatPrice } from '@/utils/format';

export const MIN_OFFER_CENTS = 100;
export const MAX_OFFER_NOTE = 280;

type DateLike = Date | string;

export interface OfferWindow {
  startsAt: DateLike;
  endsAt: DateLike;
}

export interface OfferSpot {
  id: string;
  name: string;
  description?: string | null;
}

export interface OfferProposal {
  startsAt: Date;
  spotId: string;
}

export interface OfferSheetProps {
  visible: boolean;
  onClose: () => void;
  askingPriceCents: number;
  submitting: boolean;
  serverError: ServerErrorLike | null;
  onSubmit: (amountCents: number, message: string | undefined, proposal: OfferProposal) => void;
  /** The listing's availability windows and chosen spots. */
  windows?: OfferWindow[];
  spots?: OfferSpot[];
  /** Campus IANA timezone; all times display in it. */
  timeZone?: string;
}

interface WindowChoice {
  key: string;
  start: number;
  end: number;
  slots: number[];
}

/** Future 15-minute starts that fit inside [start, end), within the next 24h. */
function slotsIn(start: number, end: number, now: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(Math.max(start, now) / SLOT_MS) * SLOT_MS;
  for (let t = first; t + SLOT_MS <= end && t < now + DAY_MS; t += SLOT_MS) out.push(t);
  return out;
}

export function validateOfferAmount(text: string, askingPriceCents: number): { cents: number | null; error?: string } {
  if (!text.trim()) return { cents: null, error: 'Enter the amount you want to offer.' };
  const cents = parseDollarsToCents(text);
  if (cents === null) return { cents: null, error: 'Enter a dollar amount like 20 or 20.50.' };
  if (cents < MIN_OFFER_CENTS) return { cents, error: 'Offers start at $1.' };
  if (cents >= askingPriceCents) {
    return {
      cents,
      error: `Offer less than the asking price of ${formatPrice(askingPriceCents)}, or book it at the asking price.`,
    };
  }
  return { cents };
}

export function OfferSheet({
  visible,
  onClose,
  askingPriceCents,
  submitting,
  serverError,
  onSubmit,
  windows = [],
  spots = [],
  timeZone,
}: OfferSheetProps) {
  const { height } = useWindowDimensions();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [windowKey, setWindowKey] = useState<string | null>(null);
  const [slotMs, setSlotMs] = useState<number | null>(null);
  const [spotId, setSpotId] = useState<string | null>(null);

  // "Now" is refreshed every minute while the sheet is open so a time that
  // passes while the sheet sits there disappears instead of being submittable.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [visible]);

  // Reset the form each time the sheet opens (adjust state during render,
  // the React-recommended alternative to an effect).
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) {
      setAmount('');
      setNote('');
      setTouched(false);
      setSubmitted(false);
      setWindowKey(null);
      setSlotMs(null);
      setSpotId(null);
    }
  }

  const choices: WindowChoice[] = useMemo(
    () =>
      windows
        .map((w, i) => {
          const start = new Date(w.startsAt).getTime();
          const end = new Date(w.endsAt).getTime();
          return { key: `${i}-${start}`, start, end, slots: slotsIn(start, end, now) };
        })
        .filter((c) => c.slots.length > 0)
        .sort((a, b) => a.start - b.start),
    [windows, now],
  );

  // Effective selection: the user's pick if it is still valid, else a default.
  const activeWindow = choices.find((c) => c.key === windowKey) ?? choices[0];
  const activeSlot =
    activeWindow && slotMs != null && activeWindow.slots.includes(slotMs) ? slotMs : activeWindow?.slots[0];
  const activeSpot = spots.find((s) => s.id === spotId) ?? spots[0];

  const { cents, error } = validateOfferAmount(amount, askingPriceCents);
  const canPropose = !!activeWindow && activeSlot != null && !!activeSpot;
  const showError = touched && (amount.length > 0 || submitted) ? error : undefined;

  function submit() {
    setTouched(true);
    setSubmitted(true);
    if (error || cents === null || !canPropose) return;
    onSubmit(cents, note.trim() || undefined, { startsAt: new Date(activeSlot), spotId: activeSpot.id });
  }

  const noTimes = choices.length === 0;
  const noSpots = spots.length === 0;

  return (
    <Sheet visible={visible} onClose={onClose} title="Make an offer">
      <ScrollView
        style={{ maxHeight: height * 0.72 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="body" color="inkMuted">
          Asking price is {formatPrice(askingPriceCents)}. Offer a price and pick one of the seller&apos;s times and
          spots. If they accept, the item is held for you for one hour so you can confirm. You can send one open offer
          at a time. No money moves in this prototype.
        </Text>

        <Input
          label="Your offer ($)"
          value={amount}
          onChangeText={setAmount}
          onBlur={() => setTouched(true)}
          placeholder="0.00"
          keyboardType="decimal-pad"
          error={showError}
          accessibilityHint="Dollars. At least 1 and less than the asking price"
        />

        {noTimes || noSpots ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Text variant="label" weight="600">
              {noTimes ? 'No meetup times left' : 'No meetup spots listed'}
            </Text>
            <Text variant="caption" color="inkMuted">
              {noTimes
                ? 'Every time the seller offered has passed, so there is nothing to propose right now. Check back if they add more.'
                : 'The seller has not picked a meetup spot, so there is nowhere to propose. Check back if they add one.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.group}>
              <Text variant="label" weight="600">
                When the seller is free
              </Text>
              <View style={styles.wrap}>
                {choices.map((c) => {
                  const shownStart = c.slots[0]!;
                  return (
                    <ChoiceChip
                      key={c.key}
                      label={relativeDayLabel(shownStart, timeZone, new Date(now))}
                      sublabel={`${clockTime(shownStart, timeZone)} – ${clockTime(c.end, timeZone)}`}
                      selected={c.key === activeWindow!.key}
                      onPress={() => {
                        setWindowKey(c.key);
                        setSlotMs(null);
                      }}
                    />
                  );
                })}
              </View>
              <Text variant="caption" color="inkMuted">
                Start time
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeRow}>
                {activeWindow!.slots.map((t) => (
                  <ChoiceChip
                    key={t}
                    label={clockTime(t, timeZone)}
                    selected={t === activeSlot}
                    onPress={() => setSlotMs(t)}
                    accessibilityLabel={`Start at ${clockTime(t, timeZone)}`}
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.group}>
              <Text variant="label" weight="600">
                Where
              </Text>
              <View style={styles.wrap}>
                {spots.map((sp) => (
                  <ChoiceChip
                    key={sp.id}
                    label={sp.name}
                    selected={sp.id === activeSpot!.id}
                    onPress={() => setSpotId(sp.id)}
                    accessibilityLabel={sp.description ? `${sp.name}. ${sp.description}` : sp.name}
                  />
                ))}
              </View>
              {activeSpot?.description ? (
                <Text variant="caption" color="inkMuted">
                  {activeSpot.description}
                </Text>
              ) : null}
            </View>

            <View style={styles.summary} accessibilityLiveRegion="polite">
              <Text variant="caption" color="inkMuted">
                Your proposal
              </Text>
              <Text variant="label" weight="700">
                {cents !== null && !error ? formatPrice(cents) : 'Your price'} ·{' '}
                {exactMeetupTime(activeSlot!, timeZone)}
              </Text>
              <Text variant="label">{activeSpot!.name}</Text>
            </View>
          </>
        )}

        <TextArea
          label="Note to the seller (optional)"
          value={note}
          onChangeText={(t) => setNote(t.slice(0, MAX_OFFER_NOTE))}
          maxLength={MAX_OFFER_NOTE}
          placeholder="e.g. I'll be at the main door"
          helper={`${note.length}/${MAX_OFFER_NOTE}`}
        />
        <ServerErrorNote error={serverError} onDismiss={onClose} />
        <Button
          title="Send offer"
          onPress={submit}
          loading={submitting}
          disabled={!canPropose || (touched && (amount.length > 0 || submitted) && !!error)}
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.lg },
  group: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  timeRow: { flexDirection: 'row', gap: space.sm, paddingRight: space.md },
  notice: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.line,
  },
  summary: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
});

export default OfferSheet;
