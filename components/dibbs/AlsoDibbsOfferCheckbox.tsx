/**
 * Optional, unchecked-by-default checkbox on the List flow: "Also get a Dibbs
 * offer". When checked, the listing publishes as usual and the same item is
 * also sent privately to the Dibbs buying team (dibbsOffer.create with the
 * listing id). The listing's own photos are used; no extra upload.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Text } from '@/components/ui/Text';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';

export function AlsoDibbsOfferCheckbox({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      // React Native Web doesn't map accessibilityState to aria-checked here.
      aria-checked={checked}
      accessibilityLabel="Also get a Dibbs offer. Sends this item to the Dibbs team privately as well."
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.row, checked && styles.rowChecked, pressed && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Check size={16} color={colors.white} strokeWidth={3} /> : null}
      </View>
      <View style={styles.text}>
        <Text variant="label" weight="600">
          Also get a Dibbs offer
        </Text>
        <Text variant="caption" color="inkMuted">
          Sends this item to the Dibbs team privately as well, so they can send you an estimate. Your listing stays live
          either way. Nothing is bought unless you agree.
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    minHeight: minTouchHeight,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowChecked: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.85 },
  box: {
    width: 24,
    height: 24,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.inkMuted,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  boxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { flex: 1, gap: 2 },
});

export default AlsoDibbsOfferCheckbox;
