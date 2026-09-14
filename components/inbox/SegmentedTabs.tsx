/**
 * Two-segment tab control for the Inbox screen (Messages / Requests).
 * Usage: <SegmentedTabs segments={[{key:'messages',label:'Messages'},...]}
 *   value={tab} onChange={setTab} />
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space, minTouchHeight } from '@/constants/theme';
import { Text } from '../ui/Text';

export interface SegmentedTabOption<T extends string> {
  key: T;
  label: string;
  /** Optional small badge count, e.g. unread messages or requests needing reply. */
  badge?: number;
}

export interface SegmentedTabsProps<T extends string> {
  segments: SegmentedTabOption<T>[];
  value: T;
  onChange: (key: T) => void;
}

export function SegmentedTabs<T extends string>({ segments, value, onChange }: SegmentedTabsProps<T>) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {segments.map((seg) => {
        const selected = seg.key === value;
        return (
          <Pressable
            key={seg.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={seg.badge ? `${seg.label}, ${seg.badge} new` : seg.label}
            onPress={() => onChange(seg.key)}
            style={({ pressed }) => [styles.segment, selected && styles.segmentSelected, pressed && styles.pressed]}
          >
            <Text variant="heading" weight="600" color={selected ? 'ink' : 'inkMuted'}>
              {seg.label}
            </Text>
            {seg.badge ? (
              <View style={styles.badge}>
                <Text variant="caption" weight="600" color="white">
                  {seg.badge > 9 ? '9+' : seg.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: minTouchHeight - 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.sm,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SegmentedTabs;
