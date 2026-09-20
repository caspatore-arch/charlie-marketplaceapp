/**
 * List of meetup spots to choose from (request-meetup flow, sell-listing spot
 * multi-select). Usage:
 * <SpotPicker spots={spots} selectedId={spotId} onSelect={setSpotId} />
 * For multi-select (Sell screen), pass `selectedIds` + `onToggle` instead.
 *
 * Single-select mode also supports a secondary "Use another address" flow
 * (docs/AUCTIONS.md §2): pass `campusId` + `customAddress` +
 * `onCustomAddressChange` and the picker adds a collapsed "Use another
 * address" row below the campus spots. Expanding it shows the safety line, an
 * address input, and a "Check address" action that geocodes + validates the
 * address is within the campus radius (`reservation.checkAddress`) before
 * showing a resolved confirmation with distance. Campus spots stay listed
 * first and visually primary; the custom address is always secondary.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';
import { Text } from './ui/Text';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { DemoBadge } from './DemoBadge';
import { trpc } from '@/lib/trpc';
import type { MeetupSpot } from '@/types';

export interface ResolvedCustomAddress {
  address: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

export interface SpotPickerProps {
  spots: MeetupSpot[];
  selectedId?: string | null;
  onSelect?: (spotId: string) => void;
  selectedIds?: string[];
  onToggle?: (spotId: string) => void;
  /** Single-select mode only — enables the "Use another address" option. */
  campusId?: string;
  customAddress?: ResolvedCustomAddress | null;
  onCustomAddressChange?: (resolved: ResolvedCustomAddress | null) => void;
}

export function SpotPicker({
  spots,
  selectedId,
  onSelect,
  selectedIds,
  onToggle,
  campusId,
  customAddress,
  onCustomAddressChange,
}: SpotPickerProps) {
  const multi = !!onToggle;
  const allowCustom = !multi && !!campusId && !!onCustomAddressChange;

  const [expanded, setExpanded] = useState(!!customAddress);
  const [addressInput, setAddressInput] = useState(customAddress?.address ?? '');
  const [checkError, setCheckError] = useState<string | undefined>();

  const checkMutation = trpc.reservation.checkAddress.useMutation({
    onSuccess: (result) => {
      setCheckError(undefined);
      onCustomAddressChange?.({
        address: result.address,
        lat: result.lat,
        lng: result.lng,
        distanceMeters: result.distanceMeters,
      });
    },
    onError: (err) => {
      setCheckError(err.message);
      onCustomAddressChange?.(null);
    },
  });

  const runCheck = () => {
    const trimmed = addressInput.trim();
    if (trimmed.length < 3 || !campusId) return;
    checkMutation.mutate({ campusId, address: trimmed });
  };

  // Every demo spot carries the same hours caveat. Printed on all four rows it
  // reads as four separate warnings and stops being read at all, so when the
  // note is identical across the list it is shown once beneath it instead.
  const firstNote = spots[0]?.hoursNote ?? null;
  const sharedNote =
    spots.length > 1 && firstNote && spots.every((s) => s.hoursNote === firstNote)
      ? firstNote
      : null;

  return (
    <View style={styles.list}>
      {spots.map((spot) => {
        const selected = multi ? !!selectedIds?.includes(spot.id) : selectedId === spot.id && !customAddress;
        return (
          <Pressable
            key={spot.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${spot.name}. ${spot.description}`}
            onPress={() => {
              if (multi) {
                onToggle?.(spot.id);
              } else {
                onCustomAddressChange?.(null);
                onSelect?.(spot.id);
              }
            }}
            style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
          >
            <View style={styles.rowInfo}>
              <View style={styles.nameRow}>
                <Text variant="label" weight="600">
                  {spot.name}
                </Text>
                <DemoBadge visible={spot.isDemo} />
              </View>
              <Text variant="caption" color="inkMuted">
                {spot.description}
              </Text>
              {spot.hoursNote && !sharedNote ? (
                <Text variant="caption" color="inkFaint">
                  {spot.hoursNote}
                </Text>
              ) : null}
            </View>
            <View style={[styles.radio, selected && styles.radioSelected]} />
          </Pressable>
        );
      })}

      {sharedNote ? (
        <Text variant="caption" color="inkFaint" style={styles.sharedNote}>
          {sharedNote}
        </Text>
      ) : null}

      {allowCustom ? (
        <View style={styles.customBlock}>
          {!expanded ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use another address instead of a campus spot"
              onPress={() => setExpanded(true)}
              style={({ pressed }) => [styles.customToggle, pressed && styles.pressed]}
            >
              <Text variant="label" color="accent" weight="600">
                Use another address
              </Text>
            </Pressable>
          ) : (
            <View style={styles.customForm}>
              <Text variant="caption" color="inkMuted" style={styles.safetyLine}>
                Public places are safer for meeting someone new. Only share an address you&apos;re
                comfortable with.
              </Text>
              <Input
                label="Address"
                value={addressInput}
                onChangeText={(t) => {
                  setAddressInput(t);
                  if (customAddress) onCustomAddressChange?.(null);
                  setCheckError(undefined);
                }}
                placeholder="e.g. 900 E University Blvd, Tucson, AZ"
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={runCheck}
                accessibilityHint="Enter a street address to check it is within the campus meetup area"
              />
              {checkError ? (
                <Text variant="caption" color="danger" accessibilityRole="alert">
                  {checkError}
                </Text>
              ) : null}
              {customAddress ? (
                <View style={styles.resolvedBox} accessibilityRole="text">
                  <Text variant="label" weight="600">
                    {customAddress.address}
                  </Text>
                  <Text variant="caption" color="success">
                    {(customAddress.distanceMeters / 1609.34).toFixed(1)} mi from campus center — within range
                  </Text>
                </View>
              ) : (
                <Button
                  title="Check address"
                  variant="secondary"
                  onPress={runCheck}
                  loading={checkMutation.isPending}
                  disabled={addressInput.trim().length < 3}
                />
              )}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  sharedNote: { marginTop: space.xs },
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
  rowSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.85 },
  rowInfo: { flex: 1, gap: 2, paddingRight: space.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.line,
  },
  radioSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  customBlock: { marginTop: space.xs },
  customToggle: {
    minHeight: minTouchHeight,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  customForm: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceMuted,
  },
  safetyLine: { lineHeight: 16 },
  resolvedBox: {
    padding: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.successSoft,
    gap: 2,
  },
});

export default SpotPicker;
