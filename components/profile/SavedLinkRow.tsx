/** Profile row linking to /saved ("Saved (N)"), shown above the profile grid. */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Heart } from 'lucide-react-native';
import { Text } from '../ui/Text';
import { colors, minTouchHeight, radius, space } from '@/constants/theme';

export function SavedLinkRow({ count }: { count?: number }) {
  const router = useRouter();
  const label = count === undefined ? 'Saved' : `Saved (${count})`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, open your saved items`}
      onPress={() => router.push('/saved')}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Heart size={22} color={colors.accent} />
      <View style={styles.text}>
        <Text variant="heading">{label}</Text>
        <Text variant="caption" color="inkMuted">
          Items you might want, soonest-expiring first
        </Text>
      </View>
      <ChevronRight size={20} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: minTouchHeight + 8,
    padding: space.lg,
    marginBottom: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.85 },
  text: { flex: 1, gap: 2 },
});
